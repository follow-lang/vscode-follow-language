import {
  ASTNode,
  AxiomASTNode,
  OpAstNode,
  ParamPair,
  TermASTNode,
  ThmASTNode,
  TypeASTNode,
  NodeTypes,
  TokenTypes,
  ErrorTypes,
  Error,
  Position,
  Keywords,
  Token,
} from './types';
import { RangeImpl } from './scanner';

export class Parser {
  public astNodes: ASTNode[] = [];
  public unknownTokens: Token[] = [];
  public commentTokens: Token[] = [];
  public errors: Error[] = [];
  public parse(tokens: Token[]) {
    this.unknownTokens = [];
    this.commentTokens = [];
    this.astNodes = [];
    this.errors = [];
    const tokenBlocks = this.tokensSplit(tokens);
    for (const block of tokenBlocks) {
      switch (block[0].content) {
        case Keywords.TYPE:
          this.parseTypeNode(block);
          break;
        case Keywords.TERM:
          this.parseTermNode(block);
          break;
        case Keywords.AXIOM:
          this.parseAxiomNode(block);
          break;
        case Keywords.THM:
          this.parseThmNode(block);
          break;
      }
    }
    return this.astNodes;
  }
  public parseThmNode(tokens: Token[]) {
    const keyword = tokens[0];
    const name = tokens.at(1);
    // name missing
    if (name === undefined || name.type !== TokenTypes.WORD) {
      this.errors.push({
        type: ErrorTypes.NameMissing,
        token: name || keyword,
      });
      return;
    }
    name.type = TokenTypes.THMNAME;
    // parse params
    let leftBrace = tokens.at(2);
    if (leftBrace === undefined || leftBrace.content !== '(') {
      this.errors.push({
        type: ErrorTypes.LeftParenMissing,
        token: leftBrace || name,
      });
      return;
    }
    let i = 3;
    for (; i < tokens.length; i++) {
      if (tokens[i].content !== ',' && tokens[i].type !== TokenTypes.WORD) {
        break;
      }
    }
    let rightBrace = tokens.at(i);
    const params = this.parseParams(tokens.slice(3, i));
    if (i === tokens.length || tokens[i].content !== ')') {
      this.errors.push({
        type: ErrorTypes.RightParenMissing,
        token: tokens[i - 1] || leftBrace,
      });
    } else {
      i += 1;
    }
    // body.
    let content: Token[] = [];
    if (i < tokens.length) {
      if (tokens[i].content !== '{') {
        this.errors.push({
          type: ErrorTypes.LeftBraceMissing,
          token: tokens[i],
        });
      } else {
        leftBrace = tokens[i];
        i += 1;
      }
      let j = i + 1;
      while (j < tokens.length && tokens[j].content !== '}') {
        j++;
      }
      if (i < j) {
        content = tokens.slice(i, j);
      }
      i = j;
    }
    rightBrace = tokens.at(i);
    i += 1;
    if (rightBrace === undefined) {
      this.errors.push({
        type: ErrorTypes.RightBraceMissing,
        token: leftBrace,
      });
    }
    const paramSet: Set<string> = new Set(params.map((p) => p.name.content));
    const { targets, assumptions, diffs } = this.parseBody(content, paramSet);
    if (targets.length === 0) {
      this.errors.push({
        type: ErrorTypes.TargetMissing,
        token: name,
      });
      return;
    }
    const eqNode = tokens.at(i);
    if (eqNode === undefined || eqNode.content !== '=') {
      this.errors.push({
        type: ErrorTypes.LeftBraceMissing,
        token: name,
      });
    } else {
      i += 1;
    }
    // proof.
    let proofTokens: Token[] = [];
    if (i < tokens.length) {
      if (tokens[i].content !== '{') {
        this.errors.push({
          type: ErrorTypes.LeftBraceMissing,
          token: tokens[i],
        });
      } else {
        i += 1;
      }
      let j = i + 1;
      while (j < tokens.length && tokens[j].content !== '}') {
        j++;
      }
      if (i < j) {
        proofTokens = tokens.slice(i, j);
      }
      i = j;
    }

    const proof = this.parseOpNode(proofTokens);
    // empty proof 继续进入compile阶段，被当成axiom

    // range
    let end: Position = proof.at(-1)?.range.end || keyword.range.end;
    const lastTarget = targets.at(-1);
    if (lastTarget && lastTarget.range.end.line >= end.line && lastTarget.range.end.character >= end.character) {
      end = lastTarget.range.end;
    }
    const lastAssume = assumptions.at(-1);
    if (lastAssume && lastAssume.range.end.line >= end.line && lastAssume.range.end.character >= end.character) {
      end = lastAssume.range.end;
    }
    const lastDiff = diffs.at(-1)?.at(-1);
    if (lastDiff && lastDiff.range.end.line >= end.line && lastDiff.range.end.character >= end.character) {
      end = lastDiff.range.end;
    }

    const nodetype: NodeTypes.THM = NodeTypes.THM;
    const range = new RangeImpl(keyword.range.start, tokens.at(-1)?.range.end || end);
    const astNode: ThmASTNode = {
      nodetype: nodetype,
      range: range,
      keyword: keyword,
      name: name,
      params: params,
      assumptions: assumptions,
      targets: targets,
      diffs: diffs,
      proof: proof,
    };
    this.astNodes.push(astNode);
  }
  public parseAxiomNode(tokens: Token[]) {
    const keyword = tokens[0];
    const name = tokens.at(1);
    // name missing
    if (name === undefined || name.type !== TokenTypes.WORD) {
      this.errors.push({
        type: ErrorTypes.NameMissing,
        token: name || keyword,
      });
      return;
    }
    name.type = TokenTypes.AXIOMNAME;
    // parse params
    let leftBrace = tokens.at(2);
    if (leftBrace === undefined || leftBrace.content !== '(') {
      this.errors.push({
        type: ErrorTypes.LeftParenMissing,
        token: leftBrace || name,
      });
      return;
    }
    let i = 3;
    for (; i < tokens.length; i++) {
      if (tokens[i].content !== ',' && tokens[i].type !== TokenTypes.WORD) {
        break;
      }
    }
    let rightBrace = tokens.at(i);
    const params = this.parseParams(tokens.slice(3, i));
    if (i === tokens.length || tokens[i].content !== ')') {
      this.errors.push({
        type: ErrorTypes.RightParenMissing,
        token: tokens[i - 1] || leftBrace,
      });
    } else {
      i += 1;
    }
    // body.
    let content: Token[] = [];
    if (i < tokens.length) {
      if (tokens[i].content !== '{') {
        this.errors.push({
          type: ErrorTypes.LeftBraceMissing,
          token: tokens[i],
        });
      } else {
        leftBrace = tokens[i];
        i += 1;
      }
      let j = i + 1;
      while (j < tokens.length && tokens[j].content !== '}') {
        j++;
      }
      if (i < j) {
        content = tokens.slice(i, j);
      }
      i = j;
    }
    rightBrace = tokens.at(i);
    if (rightBrace === undefined) {
      this.errors.push({
        type: ErrorTypes.RightBraceMissing,
        token: leftBrace,
      });
    }
    const paramSet: Set<string> = new Set(params.map((p) => p.name.content));
    const { targets, assumptions, diffs } = this.parseBody(content, paramSet);
    if (targets.length === 0) {
      this.errors.push({
        type: ErrorTypes.TargetMissing,
        token: name,
      });
    }

    // range
    let end: Position | undefined = keyword.range.end;
    const lastTarget = targets.at(-1);
    if (lastTarget && lastTarget.range.end.line >= end.line && lastTarget.range.end.character >= end.character) {
      end = lastTarget.range.end;
    }
    const lastAssume = assumptions.at(-1);
    if (lastAssume && lastAssume.range.end.line >= end.line && lastAssume.range.end.character >= end.character) {
      end = lastAssume.range.end;
    }
    const lastDiff = diffs.at(-1)?.at(-1);
    if (lastDiff && lastDiff.range.end.line >= end.line && lastDiff.range.end.character >= end.character) {
      end = lastDiff.range.end;
    }

    const nodetype: NodeTypes.AXIOM = NodeTypes.AXIOM;
    const range = new RangeImpl(keyword.range.start, rightBrace?.range.end || end);
    const astNode: AxiomASTNode = {
      nodetype: nodetype,
      range: range,
      keyword: keyword,
      name: name,
      params: params,
      assumptions: assumptions,
      targets: targets,
      diffs: diffs,
    };
    this.astNodes.push(astNode);
  }
  private parseBody(content: Token[], paramSet: Set<string>) {
    const statements = [];
    for (const token of content) {
      if (token.content === Keywords.TARGET || token.content === Keywords.ASSUME || token.content === Keywords.DIFF) {
        statements.push([token]);
        continue;
      }
      const last = statements.at(-1);
      if (last) {
        last.push(token);
      } else {
        this.errors.push({
          type: ErrorTypes.BodyKeywordMissing,
          token: token,
        });
      }
    }
    const targets: OpAstNode[] = [];
    const assumptions: OpAstNode[] = [];
    const diffs: Token[][] = [];
    for (const stmt of statements) {
      if (stmt[0].content === Keywords.TARGET || stmt[0].content === Keywords.ASSUME) {
        const opNodes = this.parseOpNode(stmt.slice(1));
        if (opNodes.length === 0) {
          this.errors.push({
            type: stmt[0].content === Keywords.TARGET ? ErrorTypes.EmptyTargetBodyStmt : ErrorTypes.EmptyAssumeBodyStmt,
            token: stmt[0],
          });
        } else {
          if (stmt[0].content === Keywords.TARGET) {
            targets.push(...opNodes);
          } else {
            assumptions.push(...opNodes);
          }
        }
      } else {
        // parse `diff (s1, s2) (s3, s4)
        const diffParts = this.parseDiff(stmt, paramSet);
        if (diffParts.length === 0) {
          this.errors.push({
            type: ErrorTypes.EmptyDiffBodyStmt,
            token: stmt[0],
          });
        } else {
          diffs.push(...diffParts);
        }
      }
    }
    return {
      targets: targets,
      assumptions: assumptions,
      diffs: diffs,
    };
  }
  private parseDiff(tokens: Token[], paramSet: Set<string>): Token[][] {
    const parts: Token[][] = [];
    for (const token of tokens) {
      if (token.content === '(') {
        parts.push([]);
        continue;
      } else if (token.type === TokenTypes.WORD) {
        if (!paramSet.has(token.content)) {
          // arg 的名字本来就不允许和 term 的名字一样，所以只需要限制 arg 之间就好了。
          this.errors.push({
            type: ErrorTypes.DiffIsNotArg,
            token: token,
          });
        } else {
          const last = parts.at(-1);
          token.type = TokenTypes.ARGNAME;
          if (last) {
            const same = last.filter((t) => t.content === token.content);
            if (same.length > 0) {
              this.errors.push({
                type: ErrorTypes.DupDiff,
                token: token,
              });
            } else {
              last.push(token);
            }
          } else {
            parts.push([token]);
          }
        }
      }
    }
    parts
      .filter((part) => part.length === 1)
      .forEach((part) => {
        const token = part[0];
        this.errors.push({
          type: ErrorTypes.SingleDiff,
          token: token,
        });
      });
    return parts.filter((part) => part.length > 1);
  }
  private parseOpNode(tokens: Token[]): OpAstNode[] {
    let stack: (Token | OpAstNode)[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === TokenTypes.WORD) {
        if (i + 1 < tokens.length && tokens[i + 1].content === '(') {
          stack.push(token);
          i += 1;
        } else {
          const node: OpAstNode = {
            root: token,
            children: [],
            range: token.range,
          };
          stack.push(node);
        }
      } else if (token.content === ')') {
        let j = stack.length - 1;
        const children: OpAstNode[] = [];
        for (; j >= 0; j--) {
          const node = stack[j];
          if ('root' in node && 'children' in node && 'range' in node) {
            children.push(node);
          } else {
            break;
          }
        }
        if (j >= 0) {
          const root = stack[j] as Token;
          stack = stack.slice(0, j);
          const range = new RangeImpl(root.range.start, token.range.end || children.at(0)?.range.end || root.range.end);

          children.reverse();
          const node: OpAstNode = {
            root: root,
            children: children,
            range: range,
          };
          if (children.length === 0) {
            root.type = TokenTypes.CONSTNAME;
          } else {
            root.type = TokenTypes.TERMNAME;
          }
          stack.push(node);
        }
      }
    }
    const rst: OpAstNode[] = [];
    for (const node of stack) {
      if ('root' in node && 'children' in node && 'range' in node) {
        rst.push(node);
      } else {
        this.errors.push({
          type: ErrorTypes.RightParenMissing,
          token: node,
        });
      }
    }
    return rst;
  }
  public parseTermNode(tokens: Token[]) {
    const keyword = tokens[0];
    const type = tokens.at(1);
    // type missing
    if (type === undefined || type.type !== TokenTypes.WORD) {
      this.errors.push({
        type: ErrorTypes.TypeMissing,
        token: type || keyword,
      });
      return;
    }
    type.type = TokenTypes.TYPENAME;

    const name = tokens.at(2);
    // name missing
    if (name === undefined || name.type !== TokenTypes.WORD) {
      this.errors.push({
        type: ErrorTypes.NameMissing,
        token: name || type,
      });
      return;
    }
    // parse params.
    // Params is alternative in term block.
    let leftBrace = tokens.at(3);
    let rightBrace = leftBrace;
    let params: ParamPair[] = [];
    let i = 3;
    if (leftBrace && leftBrace.content === '(') {
      i += 1;
      for (; i < tokens.length; i++) {
        if (tokens[i].content !== ',' && tokens[i].type !== TokenTypes.WORD) {
          break;
        }
      }
      rightBrace = tokens.at(i);
      params = this.parseParams(tokens.slice(4, i));
      if (i === tokens.length || tokens[i].content !== ')') {
        this.errors.push({
          type: ErrorTypes.RightParenMissing,
          token: leftBrace,
        });
      } else {
        i += 1;
      }
    }
    // content. The bridge between follow language and nature language.
    // content is alternative in term block, too.
    let content: Token[] = [name]; // default content is its name.
    if (i < tokens.length) {
      if (tokens[i].content !== '{') {
        this.errors.push({
          type: ErrorTypes.LeftBraceMissing,
          token: tokens[i],
        });
      } else {
        leftBrace = tokens[i];
        i += 1;
      }
      // right most match
      let j = tokens.length - 1;
      while (j > i && tokens[j].content !== '}') {
        j--;
      }
      if (i < j) {
        content = tokens.slice(i, j);
      }
    }
    const nodetype: NodeTypes.TERM = NodeTypes.TERM;
    const range = new RangeImpl(
      keyword.range.start,
      content.at(-1)?.range.end || rightBrace?.range.end || params.at(-1)?.name.range.end || name.range.end,
    );
    const astNode: TermASTNode = {
      nodetype: nodetype,
      range: range,
      keyword: keyword,
      type: type,
      name: name,
      params: params,
      content: content,
    };
    if (params.length === 0) {
      name.type = TokenTypes.CONSTNAME;
      content.forEach((content) => {
        content.type = TokenTypes.CONSTNAME;
      });
    } else {
      name.type = TokenTypes.TERMNAME;
    }
    this.astNodes.push(astNode);
  }
  private parseParams(tokens: Token[]): ParamPair[] {
    if (tokens.length === 0) {
      return [];
    }
    let i = 0;
    const params: ParamPair[] = [];
    while (i < tokens.length) {
      if (tokens[i].type !== TokenTypes.WORD) {
        this.errors.push({
          type: ErrorTypes.ParamTypeMissing,
          token: tokens[i],
        });
        i += 1;
        continue;
      }

      tokens[i].type = TokenTypes.TYPENAME;

      if (i + 1 === tokens.length || tokens[i + 1].type !== TokenTypes.WORD) {
        this.errors.push({
          type: ErrorTypes.ParamNameMissing,
          token: tokens[i + 1] || tokens[i],
        });
        i += 2;
        continue;
      }
      tokens[i + 1].type = TokenTypes.ARGNAME;
      params.push({
        type: tokens[i],
        name: tokens[i + 1],
      });
      i += 2;

      if (i < tokens.length) {
        if (tokens[i].content !== ',') {
          continue;
        } else {
          i += 1;
        }
      }
    }
    return params;
  }
  public parseTypeNode(tokens: Token[]) {
    const keyword = tokens[0];
    const types: Token[] = [];
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].type !== TokenTypes.WORD) {
        this.unknownTokens.push(tokens[i]);
      } else {
        tokens[i].type = TokenTypes.TYPENAME;
        types.push(tokens[i]);
      }
    }
    if (types.length === 0) {
      this.errors.push({
        type: ErrorTypes.TypeMissing,
        token: keyword,
      });
    }
    const range = new RangeImpl(keyword.range.start, tokens.at(-1)?.range.start || keyword.range.end);
    const nodetype: NodeTypes.TYPE = NodeTypes.TYPE;
    const astNode: TypeASTNode = {
      nodetype: nodetype,
      range: range,
      keyword: keyword,
      types: types,
    };
    this.astNodes.push(astNode);
  }
  private tokensSplit(tokens: Token[]) {
    const tokenBlocks: Token[][] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === TokenTypes.IGNORE) {
        continue;
      } else if (token.type === TokenTypes.COMMENT) {
        this.commentTokens.push(token);
      } else if (isStartKeyToken(token)) {
        tokenBlocks.push([token]);
      } else {
        let lastBlock = tokenBlocks.at(-1);
        if (lastBlock === undefined) {
          this.unknownTokens.push(token);
        } else {
          lastBlock.push(token);
        }
      }
    }
    return tokenBlocks;
  }
}

const startKeyTokenSet: Set<string> = new Set([Keywords.TYPE, Keywords.TERM, Keywords.AXIOM, Keywords.THM]);
const isStartKeyToken = (token: Token | undefined) => {
  if (token === undefined) {
    return false;
  }
  return startKeyTokenSet.has(token.content);
};
