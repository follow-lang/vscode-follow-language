import {
  createConnection,
  TextDocuments,
  Diagnostic,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  SemanticTokensRegistrationOptions,
  SemanticTokensRegistrationType,
  SemanticTokensLegend,
  SemanticTokenTypes,
  SemanticTokenModifiers,
  DiagnosticSeverity,
  SemanticTokensBuilder,
  Range,
  Hover,
  TextEdit,
  TextDocumentEdit,
  WorkspaceEdit,
  Location,
  DocumentSelector,
  NotificationType,
} from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';

import { Position, TextDocument } from 'vscode-languageserver-textdocument';
import {
  Error,
  CNode,
  CNodeTypes,
  TypeCNode,
  Token,
  AxiomCNode,
  TermOpCNode,
  ThmCNode,
  ProofOpCNode,
  AxiomASTNode,
  ThmASTNode,
  CONTENT_FILE,
  CompilerWithImport,
  TokenTypes,
  TermASTNode,
  getFollowErrorMsg,
  cNodeToString,
} from './parser';

const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: [
    SemanticTokenTypes.keyword,
    SemanticTokenTypes.type,
    SemanticTokenTypes.number,
    SemanticTokenTypes.variable,
    SemanticTokenTypes.parameter,
    SemanticTokenTypes.operator,
    SemanticTokenTypes.method,
    SemanticTokenTypes.function,
    SemanticTokenTypes.comment,
    SemanticTokenTypes.string,
  ],
  tokenModifiers: [SemanticTokenModifiers.declaration],
};
const semanticTokensMap: Map<string, number> = new Map([
  [SemanticTokenTypes.keyword, 0],
  [SemanticTokenTypes.type, 1],
  [SemanticTokenTypes.number, 2],
  [SemanticTokenTypes.variable, 3],
  [SemanticTokenTypes.parameter, 4],
  [SemanticTokenTypes.operator, 5],
  [SemanticTokenTypes.method, 6],
  [SemanticTokenTypes.function, 7],
  [SemanticTokenTypes.comment, 8],
  [SemanticTokenTypes.string, 9],
]);

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

let compilerMap: Map<string, CompilerWithImport> = new Map(); // folder - compiler

let workspacePaths: string[] | undefined;

connection.onInitialize((params: InitializeParams) => {
  let capabilities = params.capabilities;

  if (params.workspaceFolders) {
    workspacePaths = params.workspaceFolders.map((wf) => URI.parse(wf.uri).fsPath);
    console.log('Hello');
    for (const folder of workspacePaths) {
      initContentJsonFile(folder);
    }
  }

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
  hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );
  const documentSelector: DocumentSelector = [{ language: 'follow' }];
  if (globalSettings.enableWatchMarkdown) {
    documentSelector.push({ pattern: '**/*.md' });
  }

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['(', '.'],
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: { workDoneProgress: true },
      renameProvider: true,
      semanticTokensProvider: {
        documentSelector: documentSelector,
        legend: semanticTokensLegend,
        range: false,
        full: {
          delta: true,
        },
      },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(async () => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
  }
  const registrationOptions: SemanticTokensRegistrationOptions = {
    documentSelector: [{ language: 'follow' }],
    legend: semanticTokensLegend,
    range: false,
    full: {
      delta: true,
    },
  };
  void connection.client.register(SemanticTokensRegistrationType.type, registrationOptions);
});

async function readContentJsonFile(dir: string): Promise<string[] | null> {
  try {
    const file = path.join(dir, CONTENT_FILE);
    const data = fs.readFileSync(file, 'utf8');
    const jsonData = JSON.parse(data);
    // 验证 jsonData 是否包含 "content" 键，并且其值是字符串列表
    if (jsonData.hasOwnProperty('content') && Array.isArray(jsonData.content)) {
      const content: string[] = [];
      for (const item of jsonData.content) {
        if (typeof item !== 'string') {
          continue;
        }
        const splitItems = item.split(/\\|\/+/).filter((e) => e.length > 0);
        const absPath = path.resolve(path.join(dir, ...splitItems));
        if (fs.existsSync(absPath)) {
          content.push(absPath);
        }
      }
      return content;
    }
  } catch (err) {}
  return null;
}
async function initContentJsonFile(folder: string) {
  console.log('Hello');
  if (workspacePaths?.includes(folder)) {
    // 只有workspace的Json File才会读入
    const depFileList = await readContentJsonFile(folder);
    if (depFileList === null) {
      return;
    }
    const compiler = new CompilerWithImport();
    compilerMap.set(folder, compiler);
    compiler.setImportList(depFileList);
    for (const file of depFileList) {
      const extName = path.extname(file);
      if (extName === '.md') {
        if (!globalSettings.enableWatchMarkdown) {
          continue;
        }
      } else if (extName !== '.fol') {
        continue;
      }
      try {
        const code = fs.readFileSync(file, 'utf8');
        compiler.compileCode(file, code);
        if (extName === '.md') {
          sendMarkdownRenderNotification(file);
        }
      } catch (err) {}
    }
  }
}

interface FollowSettings {
  maxNumberOfProblems: number;
  enableWatchMarkdown: boolean;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: FollowSettings = { maxNumberOfProblems: 100, enableWatchMarkdown: true };
let globalSettings: FollowSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<FollowSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <FollowSettings>(change.settings.languageServerExample || defaultSettings);
  }

  // Revalidate all open text documents
  documents.all().forEach((doc) =>
    validateTextDocument(doc).then(() => {
      const filePath = URI.parse(doc.uri).fsPath;
      sendMarkdownRenderNotification(filePath);
    }),
  );
});

function getDocumentSettings(resource: string): Thenable<FollowSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'follow',
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document).then(() => {
    const filePath: string = URI.parse(change.document.uri).fsPath;
    sendMarkdownRenderNotification(filePath);
  });
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const name = textDocument.uri;
  if (name.endsWith(CONTENT_FILE)) {
    reloadContentJsonFile(textDocument);
  } else {
    const { errors } = await processTextDocument(textDocument);
    let diagnostics = getDiagnostics(errors);
    if (diagnostics.length > globalSettings.maxNumberOfProblems) {
      diagnostics = diagnostics.slice(0, globalSettings.maxNumberOfProblems);
    }
    const uri = textDocument.uri;
    connection.sendDiagnostics({ uri, diagnostics });
  }
}

async function reloadContentJsonFile(textDocument: TextDocument) {
  const filePath: string = URI.parse(textDocument.uri).fsPath;
  const folderPath: string = path.dirname(filePath);
  await initContentJsonFile(folderPath);
}

function getCompiler(filePath: string) {
  for (const [key, value] of compilerMap.entries()) {
    if (key !== filePath && value.depFileList.includes(filePath)) {
      return value;
    }
  }
  let compiler = compilerMap.get(filePath);
  if (compiler === undefined) {
    compiler = new CompilerWithImport();
    compilerMap.set(filePath, compiler);
  }
  return compiler;
}

async function processTextDocument(textDocument: TextDocument) {
  const filePath: string = URI.parse(textDocument.uri).fsPath;
  const compiler = getCompiler(filePath);
  return compiler.compileCode(filePath, textDocument.getText());
}

function getDiagnostics(errors: Error[]): Diagnostic[] {
  return errors.map((e) => {
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: e.token.range,
      message: getFollowErrorMsg(e.type),
      source: 'follow',
    };
    return diagnostic;
  });
}

type HoverV2Content = { line: number; value: string };
type HoverV2 = {
  contents: HoverV2Content[];
};
// onHoverV2
connection.onRequest('textDocument/hoverV2', (event: TextDocumentPositionParams) => {
  const textDocument = documents.get(event.textDocument.uri);
  if (textDocument === undefined) {
    return null;
  }
  const filePath: string = URI.parse(textDocument.uri).fsPath;
  const position = event.position;
  const cNodeList = getCompiler(filePath).cNodeListMap.get(filePath) || [];
  const cNode = findCNodeByPostion(cNodeList, position);
  if (cNode) {
    if (cNode.cnodetype === CNodeTypes.AXIOM || cNode.cnodetype === CNodeTypes.THM) {
      const contents = findOpCNodePositionV2(cNode as AxiomCNode | ThmCNode, position);
      if (contents.length === 0) {
        return null;
      }
      const hover: HoverV2 = {
        contents: contents,
      };
      return hover;
    }
  }
  return null;
});

// Define a custom notification type
const MarkdownRenderNotificationType = new NotificationType<{ fileName: string; codeArray: [string, string][] }>(
  'follow/markdownRender',
);
function sendMarkdownRenderNotification(filePath: string) {
  if (filePath.endsWith('.md')) {
    const cNodeMap = getCompiler(filePath).markdownCodeMap.get(filePath);
    const tokensMap = getCompiler(filePath).markdownCodeTokensMap.get(filePath);
    if (tokensMap) {
      const codeArray: [string, string][] = [];
      tokensMap.forEach((tokens, key) => {
        const cNodes = cNodeMap
          ?.get(key)
          ?.filter((cNode) => cNode.cnodetype === CNodeTypes.AXIOM || cNode.cnodetype === CNodeTypes.THM);
        codeArray.push([key, tokensToMarkdown(tokens, cNodes as (ThmCNode | AxiomCNode)[] | undefined)]);
      });
      connection.sendNotification(MarkdownRenderNotificationType, { fileName: filePath, codeArray });
    }
  }
}

function tokenToMarkdown(token: Token | string) {
  if (typeof token === 'string') {
    return token;
  }
  switch (token.type) {
    case TokenTypes.KEY:
      return `<span class='follow-keyword'>${token.content}</span>`;
    case TokenTypes.COMMENT:
      return `<span class='follow-comment'>${token.content}</span>`;
    case TokenTypes.TYPENAME:
      return `<span class='follow-typename'>${token.content}</span>`;
    case TokenTypes.ARGNAME:
      return `<span class='follow-argument'>${token.content}</span>`;
    case TokenTypes.TERMNAME:
      return `<span class='follow-termname'>${token.content}</span>`;
    case TokenTypes.CONSTNAME:
      return `<span class='follow-constname'>${token.content}</span>`;
    case TokenTypes.AXIOMNAME:
      return `<span class='follow-axiomname'>${token.content}</span>`;
    case TokenTypes.THMNAME:
      return `<span class='follow-thmname'>${token.content}</span>`;
    case TokenTypes.SEP:
    case TokenTypes.WORD:
    case TokenTypes.IGNORE:
      return token.content;
  }
}

function tokensToMarkdown(tokens: Token[], cNodes?: (AxiomCNode | ThmCNode)[]): string {
  if (cNodes == undefined || cNodes.length === 0) {
    const codeLines: string[] = [];
    let currentLineContent: string = '';
    let preLine = -1;
    for (const token of tokens) {
      if (token.range.start.line !== preLine) {
        if (currentLineContent.length > 0) {
          codeLines.push(`<span class="code-line" data-line="${preLine}">${currentLineContent}</span>`);
        }
        currentLineContent = '';
        preLine = token.range.start.line;
      }
      currentLineContent += tokenToMarkdown(token);
    }
    if (currentLineContent.length > 0) {
      codeLines.push(currentLineContent);
    }
    return codeLines.join('');
  }
  let tokenIndex = 0;
  let currentToken = tokens.at(tokenIndex);

  const codeLines: string[] = [];
  let currentLineContent: string = '';
  let preLine = -1;

  for (const cNode of cNodes) {
    const termOpCNodes: TermOpCNode[] = [...cNode.targets, ...cNode.assumptions];
    let lastValidProofOffset = 0;
    if (cNode.cnodetype === CNodeTypes.THM) {
      const proofs = cNode.proofs.filter((proof) => proof.isUseless !== true);
      proofs.forEach((proof) => {
        termOpCNodes.push(...proof.children);
      });
      lastValidProofOffset = proofs.at(-1)?.range.end.offset || 0;
    }
    termOpCNodes.sort((a, b) => {
      return a.range.start.offset - b.range.start.offset;
    });
    for (const termOpCNode of termOpCNodes) {
      while (currentToken && currentToken.range.start.offset < termOpCNode.range.start.offset) {
        if (currentToken.range.start.line !== preLine) {
          if (preLine !== -1 && currentLineContent.trim()) {
            codeLines.push(`<span class="code-line" data-line="${preLine}">${currentLineContent}</span>`);
          }
          currentLineContent = '';
          preLine = currentToken.range.start.line;
        }

        currentLineContent += tokenToMarkdown(currentToken);
        tokenIndex += 1;
        currentToken = tokens[tokenIndex];
      }
      if (termOpCNode.range.start.line !== preLine) {
        if (preLine !== -1 && currentLineContent.trim()) {
          codeLines.push(`<span class="code-line" data-line="${preLine}">${currentLineContent}</span>`);
        }
        currentLineContent = '';
        preLine = termOpCNode.range.start.line;
      }
      if (termOpCNode.termTokens) {
        currentLineContent += termOpCNode.termTokens.map((token) => tokenToMarkdown(token)).join('');
      } else {
        currentLineContent += tokenToMarkdown(termOpCNode.root);
      }
      while (currentToken && currentToken.range.start.offset < termOpCNode.range.end.offset) {
        if (currentToken.content.includes('\n') || currentToken.type === TokenTypes.COMMENT) {
          // 回车和注释还是可以保留的
          if (currentToken.range.start.line !== preLine) {
            if (preLine !== -1 && currentLineContent.trim()) {
              codeLines.push(`<span class="code-line" data-line="${preLine}">${currentLineContent}</span>`);
            }
            currentLineContent = '';
            preLine = currentToken.range.start.line;
          }
          currentLineContent += tokenToMarkdown(currentToken);
        }
        tokenIndex += 1;
        currentToken = tokens[tokenIndex];
      }
    }
    if (cNode.cnodetype === CNodeTypes.THM && lastValidProofOffset !== 0) {
      while (
        currentToken &&
        currentToken.range.start.offset < lastValidProofOffset &&
        !currentToken.content.includes('\n')
      ) {
        if (currentToken.range.start.line !== preLine) {
          if (preLine !== -1 && currentLineContent.trim()) {
            codeLines.push(`<span class="code-line" data-line="${preLine}">${currentLineContent}</span>`);
          }
          currentLineContent = '';
          preLine = currentToken.range.start.line;
        }
        currentLineContent += tokenToMarkdown(currentToken);
        tokenIndex += 1;
        currentToken = tokens[tokenIndex];
      }
      if (cNode.isValid) {
        currentLineContent += '\n  <span class="follow-comment">// Q.E.D.</span> ';
      } else {
        const finalState = cNode.proofProcess
          .at(-1)
          ?.map((termOpCNode) => {
            return `  <span class='follow-comment'>// |- ${termOpCNode.termContent}</span> `;
          })
          .join('\n');
        if (finalState) {
          currentLineContent += '\n' + finalState;
        }
      }
    }
  }
  while (tokenIndex < tokens.length && currentToken) {
    if (currentToken.range.start.line !== preLine) {
      if (preLine !== -1 && currentLineContent.trim()) {
        codeLines.push(`<span class="code-line" data-line="${preLine}">${currentLineContent}</span>`);
      }
      currentLineContent = '';
      preLine = currentToken.range.start.line;
    }
    currentLineContent += tokenToMarkdown(currentToken);
    tokenIndex += 1;
    currentToken = tokens[tokenIndex];
  }
  if (currentLineContent.length > 0) {
    if (preLine !== -1 && currentLineContent.trim()) {
      codeLines.push(`<span class="code-line" data-line="${preLine}">${currentLineContent}</span>`);
    }
  }
  const codeLines2 = codeLines.map((code) => code.replace(/(\s*\n+)+/g, '\n'));
  return codeLines2.join('');
}

// follow block list
connection.onRequest('follow/followBlockList', () => {
  const result2 = [];
  for (const [folderPath, compiler] of compilerMap.entries()) {
    if (folderPath.endsWith('content.follow.json')) {
      continue;
    }
    const result = [];
    const deps = compiler.depFileList;

    for (const file of deps) {
      if (file.endsWith('content.follow.json')) {
        continue;
      }
      const cNodeList = compiler.cNodeListMap.get(file) || [];
      const blocks = cNodeList
        .filter((cNode) => cNode.cnodetype === CNodeTypes.AXIOM || cNode.cnodetype === CNodeTypes.THM)
        .map((cNode) => {
          const cNode2 = cNode as AxiomCNode | ThmCNode;
          return {
            type: cNode2.astNode.keyword.content,
            name: cNode2.astNode.name.content,
            isValid: cNode.cnodetype === CNodeTypes.AXIOM ? true : (cNode as ThmCNode).isValid,
            content: cNodeToString(cNode),
          };
        });
      result.push({
        file: path.basename(file),
        blocks,
      });
    }
    result2.push({
      folder: folderPath.split(path.sep).at(-1),
      result,
    });
  }
  return result2;
});

connection.onHover((event) => {
  const textDocument = documents.get(event.textDocument.uri);
  if (textDocument === undefined) {
    return null;
  }
  const filePath: string = URI.parse(textDocument.uri).fsPath;

  const position = event.position;
  const cNodeList = getCompiler(filePath).cNodeListMap.get(filePath) || [];
  const cNode = findCNodeByPostion(cNodeList, position);
  if (cNode) {
    if (cNode.cnodetype === CNodeTypes.AXIOM || cNode.cnodetype === CNodeTypes.THM) {
      const content = findOpCNodePosition(cNode as AxiomCNode | ThmCNode, position);
      const hover: Hover = {
        contents: {
          kind: 'markdown',
          value: content,
        },
      };
      return hover;
    }
  }
  return null;
});
function findOpCNodePosition(cNode: AxiomCNode | ThmCNode, position: Position): string {
  if (positionInRange(cNode.astNode.name.range, position)) {
    const assumeStr = cNode.assumptions.map((a) => '-| ' + a.termContent).join('\n');
    const targetStr = cNode.targets.map((t) => '|- ' + t.termContent).join('\n');
    return [targetStr, assumeStr].join('\n');
  }
  for (const target of cNode.targets) {
    if (positionInRange(target.range, position)) {
      return findTermOpCNodeByPosition(target, position);
    }
  }
  for (const assumption of cNode.assumptions) {
    if (positionInRange(assumption.range, position)) {
      return findTermOpCNodeByPosition(assumption, position);
    }
  }
  if ('proofs' in cNode) {
    const proofs = (cNode as ThmCNode).proofs;
    const process = (cNode as ThmCNode).proofProcess;
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i];
      if (positionInRange(proof.range, position)) {
        return findProofByPosition(proof, process[i], position);
      }
    }
  }
  return '';
}
function findOpCNodePositionV2(cNode: AxiomCNode | ThmCNode, position: Position): HoverV2Content[] {
  const rst = [
    ...cNode.targets
      .filter((t) => t.range.end.line < position.line)
      .map((t) => {
        return {
          line: t.range.start.line,
          value: t.termContent,
        };
      }),
    ...cNode.assumptions
      .filter((a) => a.range.end.line < position.line)
      .map((t) => {
        return {
          line: t.range.start.line,
          value: t.termContent,
        };
      }),
  ];
  // 寻找前一个proof操作，用于hoverV2
  if (cNode.cnodetype === CNodeTypes.THM) {
    const proofs = (cNode as ThmCNode).proofs;
    const processes = (cNode as ThmCNode).proofProcess;
    if (proofs.length > 0) {
      let i = 0;
      if (proofs[0].range.start.line <= position.line) {
        for (; i < proofs.length; i++) {
          if (proofs[i].range.start.line >= position.line) {
            break;
          }
        }
      }
      rst.push(
        ...processes.slice(0, i).map((process, index) => {
          return {
            line: proofs[index].range.start.line,
            value: process.map((t) => t.termContent).join(';') || 'Q.E.D.',
          };
        }),
      );
    }
  }
  return rst;
}

function findProofByPosition(proof: ProofOpCNode, state: TermOpCNode[], position: Position): string {
  if (positionInRange(proof.root.range, position)) {
    const diffStr = proof.diffError && proof.diffError.length > 0 ? 'diff ' + proof.diffError.join(' ') : undefined;
    const assumeStr = proof.assumptions.map((a) => '-| ' + a.termContent).join('\n\n');
    const targetStr = proof.targets.map((t) => '|- ' + t.termContent).join('\n\n');
    const stateStr = state.map((e) => '? ' + e.termContent).join('\n\n');
    if (diffStr) {
      return [targetStr, assumeStr, diffStr, '---', stateStr].join('\n\n  ');
    }
    return [targetStr, assumeStr, '---', stateStr].join('\n\n  ');
  }
  for (const child of proof.children) {
    if (positionInRange(child.range, position)) {
      return findTermOpCNodeByPosition(child, position);
    }
  }
  return '';
}
function findTermOpCNodeByPosition(termCNode: TermOpCNode, position: Position): string {
  if (positionInRange(termCNode.root.range, position)) {
    return termCNode.termContent;
  }
  for (const child of termCNode.children) {
    if (positionInRange(child.range, position)) {
      return findTermOpCNodeByPosition(child, position);
    }
  }
  return '';
}
function findCNodeByPostion(cNodeList: CNode[], position: Position): CNode | undefined {
  let left = 0;
  let right = cNodeList.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midCNode = cNodeList[mid];
    const range = midCNode.astNode.range;
    if (positionInRange(range, position)) {
      return midCNode;
    } else if (
      range.end.line < position.line ||
      (range.end.line === position.line && range.end.character <= position.character)
    ) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
}
function positionInRange(range: Range, position: Position): Boolean {
  if (
    (range.start.line < position.line ||
      (range.start.line === position.line && range.start.character <= position.character)) &&
    (range.end.line > position.line || (range.end.line === position.line && range.end.character > position.character))
  ) {
    return true;
  }
  return false;
}

connection.onDefinition((params) => {
  const { textDocument, position } = params;
  const document = documents.get(textDocument.uri);
  if (textDocument === undefined || document === undefined) {
    return null;
  }
  const filePath: string = URI.parse(textDocument.uri).fsPath;

  const compiler = getCompiler(filePath);
  if (compiler === undefined) {
    return null;
  }
  const tokenList = compiler.tokenListMap.get(filePath) || [];
  const targetToken = findTokenByPostiion(tokenList, position);
  if (targetToken === undefined) {
    return null;
  }

  for (const [filePath, cNodeMap] of compiler.cNodeMapMap) {
    const uri = URI.file(filePath).toString();
    const document = documents.get(textDocument.uri);
    if (document === undefined) {
      continue;
    }
    const cNode = cNodeMap.get(targetToken.content);
    if (cNode) {
      const locations: Location[] = [];
      switch (cNode.cnodetype) {
        case CNodeTypes.TYPE:
          locations.push(Location.create(uri, (cNode as TypeCNode).type.range));
          break;
        case CNodeTypes.TERM:
          locations.push(Location.create(uri, (cNode.astNode as TermASTNode).name.range));
          break;
        case CNodeTypes.AXIOM:
          locations.push(Location.create(uri, (cNode.astNode as AxiomASTNode).name.range));
          break;
        case CNodeTypes.THM:
          locations.push(Location.create(uri, (cNode.astNode as ThmASTNode).name.range));
          break;
      }
      return locations;
    }
  }
  return null;
});

connection.onReferences((params) => {
  const { textDocument, position } = params;
  const document = documents.get(textDocument.uri);
  if (textDocument === undefined || document === undefined) {
    return null;
  }
  const filePath: string = URI.parse(textDocument.uri).fsPath;

  const compiler = getCompiler(filePath);
  if (compiler === undefined) {
    return null;
  }
  const tokenList = compiler.tokenListMap.get(filePath) || [];
  const targetToken = findTokenByPostiion(tokenList, position);
  if (targetToken === undefined) {
    return null;
  }
  if (targetToken.type === TokenTypes.ARGNAME) {
    // 函数内部的变量替换
    const cNodeList = getCompiler(filePath).cNodeListMap.get(filePath) || [];
    const cNode = findCNodeByPostion(cNodeList, position);
    if (cNode) {
      const tokens = getTokensFromRange(tokenList, cNode.astNode.range);
      const locations: Location[] = [];
      tokens.forEach((token) => {
        if (token.content === targetToken.content) {
          locations.push({
            uri: textDocument.uri,
            range: token.range,
          });
        }
      });
      if (locations.length === 0) {
        return null;
      }
      return locations;
    }
  }
  // 非函数内部替换
  const locations: Location[] = [];
  compiler.tokenListMap.forEach((tokens, filePath) => {
    const uri = URI.file(filePath).toString();
    const document = documents.get(textDocument.uri);
    if (document === undefined) {
      return;
    }
    tokens.forEach((token) => {
      if (token.content === targetToken.content) {
        locations.push({
          uri: uri,
          range: token.range,
        });
      }
    });
  });
  return locations;
});

connection.onRenameRequest((params) => {
  const { textDocument, position, newName } = params;
  const document = documents.get(textDocument.uri);
  if (textDocument === undefined || document === undefined) {
    return null;
  }
  const filePath: string = URI.parse(textDocument.uri).fsPath;

  const compiler = getCompiler(filePath);
  if (compiler === undefined) {
    return null;
  }
  const tokenList = compiler.tokenListMap.get(filePath) || [];
  const targetToken = findTokenByPostiion(tokenList, position);
  if (targetToken === undefined) {
    return null;
  }
  if (targetToken.type === TokenTypes.ARGNAME) {
    // 函数内部的变量替换
    const cNodeList = getCompiler(filePath).cNodeListMap.get(filePath) || [];
    const cNode = findCNodeByPostion(cNodeList, position);
    if (cNode) {
      const tokens = getTokensFromRange(tokenList, cNode.astNode.range);
      const edits: TextEdit[] = [];
      tokens.forEach((token) => {
        if (token.content === targetToken.content) {
          edits.push(TextEdit.replace(token.range, newName));
        }
      });
      if (edits.length === 0) {
        return null;
      }
      const textDocumentEdit: TextDocumentEdit = {
        textDocument: { uri: textDocument.uri, version: document.version },
        edits: edits,
      };
      const workspaceEdit: WorkspaceEdit = {
        documentChanges: [textDocumentEdit],
      };
      return workspaceEdit;
    }
  }

  // 函数Proof中的变量替换
  const cNodeList = getCompiler(filePath).cNodeListMap.get(filePath) || [];
  const cNode = findCNodeByPostion(cNodeList, position);
  if (cNode && cNode.cnodetype === CNodeTypes.THM) {
    const cNode2 = cNode as ThmCNode;
    let inProof = false;
    for (const proof of cNode2.proofs) {
      if (positionInRange(proof.range, position)) {
        inProof = true;
        break;
      }
    }
    if (inProof) {
      const tokens = getTokensFromRange(tokenList, cNode.astNode.range);
      const edits: TextEdit[] = [];
      tokens.forEach((token) => {
        if (token.content === targetToken.content) {
          edits.push(TextEdit.replace(token.range, newName));
        }
      });
      if (edits.length === 0) {
        return null;
      }
      const textDocumentEdit: TextDocumentEdit = {
        textDocument: { uri: textDocument.uri, version: document.version },
        edits: edits,
      };
      const workspaceEdit: WorkspaceEdit = {
        documentChanges: [textDocumentEdit],
      };
      return workspaceEdit;
    }
  }

  // 非函数内部替换
  const workspaceEdit: WorkspaceEdit = {
    documentChanges: [],
  };
  compiler.tokenListMap.forEach((tokens, filePath) => {
    const uri = URI.file(filePath).toString();
    const document = documents.get(textDocument.uri);
    if (document === undefined) {
      return;
    }
    const edits: TextEdit[] = [];
    tokens.forEach((token) => {
      if (token.content === targetToken.content) {
        edits.push(TextEdit.replace(token.range, newName));
      }
    });
    if (edits.length === 0) {
      return;
    }
    const textDocumentEdit: TextDocumentEdit = {
      textDocument: { uri: uri, version: document.version },
      edits: edits,
    };
    workspaceEdit.documentChanges?.push(textDocumentEdit);
  });
  return workspaceEdit;
});

function getTokensFromRange(tokenList: Token[], range: Range): Token[] {
  const leftFirst = findLeftFirstIndex(tokenList, range.start);
  const rightLast = findRightLastIndex(tokenList, range.end);
  if (leftFirst < rightLast) {
    return tokenList.slice(leftFirst, rightLast);
  }
  return [];
}

function findLeftFirstIndex(tokenList: Token[], position: Position) {
  let left = 0;
  let right = tokenList.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midToken = tokenList[mid];
    const range = midToken.range;
    if (positionInRange(range, position)) {
      right = mid - 1;
    } else if (
      range.end.line < position.line ||
      (range.end.line === position.line && range.end.character <= position.character)
    ) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return left;
}
function findRightLastIndex(tokenList: Token[], position: Position) {
  let left = 0;
  let right = tokenList.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midToken = tokenList[mid];
    const range = midToken.range;
    if (positionInRange(range, position)) {
      right = mid - 1;
    } else if (
      range.end.line < position.line ||
      (range.end.line === position.line && range.end.character <= position.character)
    ) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return right;
}

function findTokenByPostiion(tokenList: Token[], position: Position) {
  let left = 0;
  let right = tokenList.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midToken = tokenList[mid];
    const range = midToken.range;
    if (positionInRange(range, position)) {
      return midToken;
    } else if (
      range.end.line < position.line ||
      (range.end.line === position.line && range.end.character <= position.character)
    ) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
}

connection.languages.semanticTokens.on(async (event) => {
  const textDocument = documents.get(event.textDocument.uri);
  if (textDocument === undefined) {
    const builder = new SemanticTokensBuilder();
    return builder.build();
  }
  // const uri = Uri.parse(textDocument.uri);
  const filePath: string = URI.parse(textDocument.uri).fsPath;
  const compiler = getCompiler(filePath);
  let tokenList = compiler?.tokenListMap.get(filePath);

  if (tokenList === undefined) {
    const { tokens } = await processTextDocument(textDocument);
    tokenList = tokens;
  }

  const semanticTokens = buildSemanticToken(tokenList);
  return semanticTokens;
});

connection.languages.semanticTokens.onDelta(async (event) => {
  const textDocument = documents.get(event.textDocument.uri);
  if (textDocument === undefined) {
    const builder = new SemanticTokensBuilder();
    return builder.build();
  }
  // const uri = Uri.parse(textDocument.uri);
  const filePath: string = URI.parse(textDocument.uri).fsPath;
  const compiler = getCompiler(filePath);
  let tokenList = compiler?.tokenListMap.get(filePath);

  if (tokenList === undefined) {
    const { tokens } = await processTextDocument(textDocument);
    tokenList = tokens;
  }

  const semanticTokens = buildSemanticTokenDelta(tokenList, event.previousResultId);
  return semanticTokens;
});

// keyword --> keyword #569CD6
// typename --> type #ff5757
// argname --> parameter #9CDCFE
// termname --> method #ff8c00
// constname --> number #f9629f
// axiomname --> function #72a0c1
// thmname ---> function #72a0c1
// comment --> comment #6A9955
function buildSemanticToken(tokens: Token[]) {
  const builder = new SemanticTokensBuilder();
  for (const token of tokens) {
    switch (token.type) {
      case TokenTypes.KEY:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.keyword) || 0,
          0,
        );
        break;
      case TokenTypes.TYPENAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.type) || 0,
          0,
        );
        break;
      case TokenTypes.ARGNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.parameter) || 0,
          0,
        );
        break;
      case TokenTypes.TERMNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.method) || 0,
          0,
        );
        break;
      case TokenTypes.CONSTNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.number) || 0,
          0,
        );
        break;
      case TokenTypes.AXIOMNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.function) || 0,
          0,
        );
        break;
      case TokenTypes.THMNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.function) || 0,
          0,
        );
        break;
      case TokenTypes.COMMENT:
        buildCommentTokens(builder, token);
        break;
    }
  }
  return builder.build();
}

function buildSemanticTokenDelta(tokens: Token[], previousResultId: string) {
  const builder = new SemanticTokensBuilder();
  builder.previousResult(previousResultId);
  for (const token of tokens) {
    switch (token.type) {
      case TokenTypes.KEY:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.keyword) || 0,
          0,
        );
        break;
      case TokenTypes.TYPENAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.type) || 0,
          0,
        );
        break;
      case TokenTypes.ARGNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.parameter) || 0,
          0,
        );
        break;
      case TokenTypes.TERMNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.method) || 0,
          0,
        );
        break;
      case TokenTypes.CONSTNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.number) || 0,
          0,
        );
        break;
      case TokenTypes.AXIOMNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.function) || 0,
          0,
        );
        break;
      case TokenTypes.THMNAME:
        builder.push(
          token.range.start.line,
          token.range.start.character,
          token.content.length,
          semanticTokensMap.get(SemanticTokenTypes.function) || 0,
          0,
        );
        break;
      case TokenTypes.COMMENT:
        buildCommentTokens(builder, token);
        break;
    }
  }
  return builder.buildEdits();
}
function buildCommentTokens(builder: SemanticTokensBuilder, token: Token) {
  if (token.content.includes('\n')) {
    const commentLines = token.content.split('\n');
    builder.push(
      token.range.start.line,
      token.range.start.character,
      commentLines[0].length,
      semanticTokensMap.get(SemanticTokenTypes.comment) || 0,
      0,
    );
    for (let i = 1; i < commentLines.length; i++) {
      builder.push(
        token.range.start.line + i,
        0,
        commentLines[i].length,
        semanticTokensMap.get(SemanticTokenTypes.comment) || 0,
        0,
      );
    }
  } else {
    builder.push(
      token.range.start.line,
      token.range.start.character,
      token.content.length,
      semanticTokensMap.get(SemanticTokenTypes.comment) || 0,
      0,
    );
  }
}

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VS Code
  connection.console.log('We received a file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(async (_textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
  // The pass parameter contains the position of the text document in
  // which code complete got requested. For the example we ignore this
  // info and always provide the same completion items.
  const textDocument = documents.get(_textDocumentPosition.textDocument.uri);
  if (textDocument === undefined) {
    return [];
  }

  // const uri = Uri.parse(textDocument.uri);
  const filePath: string = URI.parse(textDocument.uri).fsPath;
  const compiler = getCompiler(filePath);
  let cNodeList = compiler?.cNodeListMap.get(filePath);

  if (cNodeList === undefined) {
    const { cNodes } = await processTextDocument(textDocument);
    cNodeList = cNodes;
  }

  const position = _textDocumentPosition.position;
  const cNode = findCNodeByPostion(cNodeList, position);
  const items: CompletionItem[] = [];
  if (cNode && cNode.cnodetype === CNodeTypes.THM) {
    const proofs = (cNode as ThmCNode).proofs;
    if (proofs.length === 0) {
      return [];
    }
    const cNodeSuggestions = (cNode as ThmCNode).cNodeSuggestions;
    if (cNodeSuggestions && cNodeSuggestions.length > 0) {
      items.push(
        ...cNodeSuggestions.map((s) => ({
          label: s.newText,
          kind: CompletionItemKind.Function,
          documentation: s.doc,
          textEdit: { range: s.range, newText: s.newText },
        })),
      );
    }
    const suggestions = (cNode as ThmCNode).suggestionProof;
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i];
      const suggestion = suggestions[i];
      if (suggestion.length > 0 && proof.range.start.line === position.line) {
        for (let idx = 0; idx < suggestion.length; idx++) {
          const suggestProof = suggestion[idx];
          const { newText, doc } = proofRelacementForSuggestion(proof, suggestProof);
          items.push({
            label: newText,
            kind: CompletionItemKind.Function,
            documentation: doc,
            textEdit: { range: proof.range, newText: newText },
            additionalTextEdits: suggestProof.virtualEdit,
            sortText: i.toString().padStart(3, '0') + idx.toString().padStart(3, '0'),
          });
        }
        return items;
      }
    }
  }
  return items;
});

function proofRelacementForSuggestion(proof: ProofOpCNode, suggestProof: ProofOpCNode) {
  let rst = proof.root.content + '(' + suggestProof.children.map((child) => child.funContent).join(', ') + ')';
  let rstDocArray = [
    proof.root.content + '(' + suggestProof.children.map((child) => child.termContent).join(', ') + ') {',
    ...suggestProof.targets.map((target) => '|- ' + target.termContent),
    ...suggestProof.assumptions.map((assume) => '-| ' + assume.termContent),
  ];

  if (suggestProof.diffError && suggestProof.diffError.length > 0) {
    rstDocArray.push('diff ' + suggestProof.diffError.map((diff) => '(' + diff + ')').join(' '));
  }
  rstDocArray.push('}');
  if (suggestProof.virtualEdit) {
    rstDocArray.push(
      ...suggestProof.virtualEdit.map((v) => {
        return `${v.oldText} : ${v.newTermText}`;
      }),
    );
  }
  return { newText: rst, doc: rstDocArray.join('\n') };
}

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 0) {
    item.detail = 'TypeScript details';
    item.documentation = 'TypeScript documentation';
  }
  return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
