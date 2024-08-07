import * as path from 'path';
import {
  workspace,
  ExtensionContext,
  window,
  DecorationOptions,
  Range,
  WebviewViewProvider,
  WebviewView,
  Uri,
  Webview,
  TextDocument,
} from 'vscode';

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import MarkdownIt from 'markdown-it';

import CryptoJS from 'crypto-js';

let client: LanguageClient;

type HoverV2Content = { line: number; value: string };
type HoverV2 = {
  contents: HoverV2Content[];
};
interface FollowSettings {
  maxNumberOfProblems: number;
  enableWatchMarkdown: boolean;
}
enum FollowSettingProps {
  maxNumberOfProblems = 'maxNumberOfProblems',
  enableWatchMarkdown = 'enableWatchMarkdown',
}

let markdownFollowCodeMap: Map<string, Map<string, string>>;

export function activate(context: ExtensionContext) {
  // The server is implemented in node

  let config = workspace.getConfiguration('follow');
  let serverModule: string = context.asAbsolutePath(path.join('server', 'build', 'server.js'));

  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  const decorationType = window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 0',
      color: 'grey',
    },
  });

  context.subscriptions.push(
    window.onDidChangeTextEditorSelection(async (event) => {
      const editor = event.textEditor;
      const position = editor.selection.active;
      const response = await client.sendRequest<HoverV2>('textDocument/hoverV2', {
        textDocument: { uri: editor.document.uri.toString() },
        position: position,
      });
      if (response === undefined || response === null || !('contents' in response)) {
        editor.setDecorations(decorationType, []);
        return;
      }
      const contents = response.contents;
      if (contents === undefined || contents === null || contents.length === 0) {
        editor.setDecorations(decorationType, []);
        return;
      }
      const decorationOptions: DecorationOptions[] = contents.map((content) => {
        return {
          range: new Range(position.with(content.line, 0), position.with(content.line, 0)),
          renderOptions: {
            after: {
              contentText: content.value,
            },
          },
        };
      });
      editor.setDecorations(decorationType, decorationOptions);
    }),
  );

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client

  const documentSelector = [
    { scheme: 'file', language: 'follow' },
    { scheme: 'file', pattern: '**/content.follow.json' },
  ];
  if (config.get(FollowSettingProps.enableWatchMarkdown)) {
    documentSelector.push({
      scheme: 'file',
      pattern: '**/*.md',
    });
  }

  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector,
  };

  // Create the language client and start the client.
  client = new LanguageClient('follow', 'Follow', serverOptions, clientOptions);

  // Start the client. This will also launch the server
  client.start();

  // Register a listener for markdown follow code render
  const markdownFollowCodeRenderListener = client.onNotification(
    'follow/markdownRender',
    ({ fileName, codeArray }: { fileName: string; codeArray: [string, string][] }) => {
      if (markdownFollowCodeMap === undefined) {
        markdownFollowCodeMap = new Map();
      }
      markdownFollowCodeMap.set(fileName, new Map(codeArray));
    },
  );

  context.subscriptions.push(markdownFollowCodeRenderListener);

  const followBlockListProvider = new FollowBlockListProvider(context.extensionUri);

  context.subscriptions.push(
    window.registerWebviewViewProvider(FollowBlockListProvider.viewType, followBlockListProvider),
  );
  // 监听文档保存事件
  context.subscriptions.push(
    workspace.onDidSaveTextDocument((document: TextDocument) => {
      if (client) {
        followBlockListProvider.updateTable();
      }
    }),
  );
  return {
    extendMarkdownIt(md: MarkdownIt) {
      return markdownItPlugin(md);
    },
  };
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

function markdownItPlugin(md: MarkdownIt) {
  const defaultRender =
    md.renderer.rules.fence ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const language = token.info.trim();
    const content = token.content;
    const lineNumber = token.map && token.map[0] > 0 ? token.map[0] : 0; // 获取起始行号

    if (language === 'follow') {
      const contentMd5 = CryptoJS.MD5(token.content).toString();
      const filePath = env.currentDocument.fsPath;
      const newContent = markdownFollowCodeMap?.get(filePath)?.get(contentMd5);
      if (newContent) {
        return `<pre><code class="language-${language}">${newContent}</code></pre>`;
      }
      return `<pre><code class="language-${language}"><span class="code-line" data-line="${lineNumber}">${md.utils.escapeHtml(content)}</span></code></pre>`;
    }
    // 默认渲染其他语言
    return defaultRender(tokens, idx, options, env, self);
  };

  return md;
}

type FollowBlockType = {
  folder: string;
  result: {
    file: string;
    blocks: {
      type: string;
      name: string;
      isValid: boolean | Boolean;
      content: string;
    }[];
  }[];
};

class FollowBlockListProvider implements WebviewViewProvider {
  public static readonly viewType = 'followBlockList';
  private _view?: WebviewView;

  constructor(private readonly _extensionUri: Uri) {}

  public async updateTable() {
    if (this._view) {
      const response = await client.sendRequest<FollowBlockType[]>('follow/followBlockList', {});
      this._view.webview.postMessage({ command: 'updateTables', data: response });
    }
  }

  resolveWebviewView(webviewView: WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'requestTable') {
        const response = await client.sendRequest<FollowBlockType[]>('follow/followBlockList', {});
        webviewView.webview.postMessage({ command: 'updateTables', data: response });
      }
    });
  }

  private _getHtmlForWebview(webview: Webview): string {
    // 生成包含表格的HTML内容
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Follow Block List</title>
  <style>
    .collapsible-content {
      display: none;
    }
    h2, h3 {
      cursor: pointer;
      position: relative;
      padding-left: 20px;
    }
    h2::before, h3::before {
      content: '\\25B6'; /* Right-pointing triangle */
      position: absolute;
      left: 0;
      font-size: 1em;
    }
    h2.collapsed::before, h3.collapsed::before {
      content: '\\25BC'; /* Down-pointing triangle */
    }
  </style>
</head>
<body>
  <button id="requestTableButton">request table</button>
  <div id="tablesContainer">
    <!-- 动态填充表格 -->
  </div>
  <script>
    const vscode = acquireVsCodeApi();

    const button = document.getElementById('requestTableButton');
    button.addEventListener('click', () => {
      // 请求表格数据
      console.log('send requestTable')
      vscode.postMessage({ command: 'requestTable' });
    });

    // 接收来自扩展的消息
    window.addEventListener('message', event => {
      const message = event.data;

      if (message.command === 'updateTables') {
        const tablesContainer = document.getElementById('tablesContainer');
        const node = message.data.map(tableData => {
          const tableRows = tableData.result.map((fileData, index) => {
            const blocksRows = fileData.blocks.map((block, index) => 
              \`<tr>
                <td>\${index}</td>
                <td>\${block.type}</td>
                <td>\${block.name}</td>
                <td>\${block.isValid}</td>
                <td><pre><code>\${block.content}</pre></code></td>
              </tr>\`
            ).join('');

            return \`
              <h3>\${fileData.file}-\${fileData.blocks.length}</h3>
              <div class="collapsible-content">
                <table border="1">
                  <thead>
                    <tr>
                      <th>Idx</th>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Proofed</th>
                      <th>Content</th>
                    </tr>
                  </thead>
                  <tbody>
                    \${blocksRows}
                  </tbody>
                </table>
              </div>
            \`;
          }).join('');

          return \`
            <div>
              <h2>\${tableData.folder}</h2>
              <div class="collapsible-content">
                \${tableRows}
              </div>
            </div>
          \`;
        }).join('');

        tablesContainer.innerHTML = node

        // 添加点击事件监听器
        document.querySelectorAll('h2').forEach(header => {
          header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const isVisible = content.style.display === 'block';
            content.style.display = isVisible ? 'none' : 'block';
            header.classList.toggle('collapsed', !isVisible);
          });
        });

        document.querySelectorAll('h3').forEach(header => {
          header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const isVisible = content.style.display === 'block';
            content.style.display = isVisible ? 'none' : 'block';
            header.classList.toggle('collapsed', !isVisible);
          });
        });
      }
    });
  </script>
</body>
</html>
`;
  }
}
