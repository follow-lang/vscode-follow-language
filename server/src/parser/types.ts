/**
 * A text edit applicable to a text document.
 */
export interface TextEdit {
  /**
   * The range of the text document to be manipulated. To insert
   * text into a document create a range where start === end.
   */
  range: Range;
  /**
   * The string to be inserted. For delete operations use an
   * empty string.
   */
  newText: string;

  oldText?: string;
  newTermText?: string;
}

export interface Position {
  /**
   * Line position in a document (zero-based).
   *
   * If a line number is greater than the number of lines in a document, it defaults back to the number of lines in the document.
   * If a line number is negative, it defaults to 0.
   */
  line: number;
  /**
   * Character offset on a line in a document (zero-based).
   *
   * The meaning of this offset is determined by the negotiated
   * `PositionEncodingKind`.
   *
   * If the character value is greater than the line length it defaults back to the
   * line length.
   */
  character: number;

  offset: number;
}
export interface Range {
  /**
   * The range's start position.
   */
  start: Position;
  /**
   * The range's end position.
   */
  end: Position;
}

export enum Keywords {
  TYPE = 'type',
  TERM = 'term',
  AXIOM = 'axiom',
  THM = 'thm',
  TARGET = '|-',
  ASSUME = '-|',
  DIFF = 'diff',
}

export enum TokenTypes {
  KEY,
  WORD,
  COMMENT,
  SEP,
  IGNORE,

  TYPENAME,
  ARGNAME,
  TERMNAME,
  CONSTNAME,
  AXIOMNAME,
  THMNAME,
}

export interface Token {
  type: TokenTypes;
  content: string;
  range: Range;
  error?: ErrorTypes;
  comment?: string;
}

export enum NodeTypes {
  TYPE,
  TERM,
  AXIOM,
  THM,
}

export type ASTNode = TypeASTNode | TermASTNode | AxiomASTNode | ThmASTNode;

export function astnodeToString(node: Node): string {
  switch (node.nodetype) {
    case NodeTypes.TYPE:
      const typeNode = node as TypeASTNode;
      return 'type ' + typeNode.types.map((e) => e.content).join(' ');
    case NodeTypes.TERM:
      const termNode = node as TermASTNode;
      let s1 =
        'term ' +
        termNode.type.content +
        ' ' +
        termNode.name.content +
        '(' +
        termNode.params.map((e) => e.type.content + ' ' + e.name.content).join(', ') +
        ')';
      if (termNode.content.length > 0) {
        s1 += ' {' + termNode.content.map((e) => e.content).join(' ') + '}';
      }
      return s1;
    case NodeTypes.AXIOM:
      const axiomNode = node as AxiomASTNode;
      let s2 =
        'axiom ' +
        axiomNode.name.content +
        '(' +
        axiomNode.params.map((e) => e.type.content + ' ' + e.name.content).join(', ') +
        ')' +
        '{';
      if (axiomNode.diffs.length > 0) {
        s2 += '\n' + axiomNode.diffs.map((e) => '  diff ' + e.map((t) => t.content).join(' ')).join('\n');
      }
      if (axiomNode.assumptions.length > 0) {
        s2 += '\n' + axiomNode.assumptions.map((e) => '  -| ' + opAstNodeToString(e)).join('\n');
      }
      s2 += '\n' + axiomNode.targets.map((e) => '  |- ' + opAstNodeToString(e)).join('\n') + '\n}';
      return s2;
    case NodeTypes.THM:
      const thmNode = node as ThmASTNode;
      let s3 =
        'thm ' +
        thmNode.name.content +
        '(' +
        thmNode.params.map((e) => e.type.content + ' ' + e.name.content).join(', ') +
        ')' +
        '{';
      if (thmNode.diffs.length > 0) {
        s3 += '\n' + thmNode.diffs.map((e) => '  diff ' + e.map((t) => t.content).join(' ')).join('\n');
      }
      if (thmNode.assumptions.length > 0) {
        s3 += '\n' + thmNode.assumptions.map((e) => '  -| ' + opAstNodeToString(e)).join('\n');
      }
      s3 += '\n' + thmNode.targets.map((e) => '  |- ' + opAstNodeToString(e)).join('\n') + '\n}' + ' = {\n';
      s3 += thmNode.proof.map((e) => '  ' + opAstNodeToString(e)).join('\n') + '\n}';
      return s3;
    default:
      return '';
  }
}

function opAstNodeToString(opNode: OpAstNode) {
  let s = opNode.root.content;
  if (opNode.children.length > 0) {
    s += '(' + opNode.children.map((e) => opAstNodeToString(e)).join(', ') + ')';
  }
  return s;
}

export interface Node {
  nodetype: NodeTypes;
  range: Range;
  keyword: Token;
}

export interface TypeASTNode extends Node {
  nodetype: NodeTypes.TYPE;
  types: Token[];
}
export interface TermASTNode extends Node {
  nodetype: NodeTypes.TERM;
  type: Token;
  name: Token;
  params: ParamPair[];
  content: Token[];
}
export interface AxiomASTNode extends Node {
  nodetype: NodeTypes.AXIOM;
  name: Token;
  params: ParamPair[];
  targets: OpAstNode[];
  assumptions: OpAstNode[];
  diffs: Token[][];
}
export interface ThmASTNode extends Node {
  nodetype: NodeTypes.THM;
  name: Token;
  params: ParamPair[];
  targets: OpAstNode[];
  assumptions: OpAstNode[];
  proof: OpAstNode[];
  diffs: Token[][];
}
export interface ParamPair {
  type: Token;
  name: Token;
}
export interface OpAstNode {
  root: Token;
  children: OpAstNode[];
  range: Range;
}

export enum ErrorTypes {
  // parse error
  TypeMissing,
  NameMissing,
  LeftParenMissing,
  RightParenMissing,
  ParamTypeMissing,
  ParamNameMissing,
  LeftBraceMissing,
  RightBraceMissing,
  BodyKeywordMissing,
  EmptyBodyStmt,
  EmptyTargetBodyStmt,
  EmptyAssumeBodyStmt,
  EmptyDiffBodyStmt,
  DupDiff,
  SingleDiff,
  DiffNotWord,
  TargetMissing,
  // ProofEmpty, empty proof 继续进入compile阶段，被当成axiom
  // compile error
  DupDefType,
  TypeDefMissing,
  NotType,
  DupName,
  DupArgName,
  DiffIsKeyword,
  DiffIsNotArg,
  TermDefMissing,
  TooManyArg,
  TooLessArg,
  ArgTypeError,
  AxiomThmDefMissing,
  ProofDiffError,
  ProofOpUseless,
  ThmWithoutValidProof,
}

export interface Error {
  type: ErrorTypes;
  token: Token;
}

export enum CNodeTypes {
  TYPE,
  TERM,
  AXIOM,
  THM,
}
export interface CNode {
  cnodetype: CNodeTypes;
  astNode: Node;
}

export type CompilerNode = TypeCNode | TermCNode | AxiomCNode | ThmCNode;

export interface TypeCNode extends CNode {
  cnodetype: CNodeTypes.TYPE;
  astNode: TypeASTNode;
  type: Token;
}

export interface TermCNode extends CNode {
  cnodetype: CNodeTypes.TERM;
  astNode: TermASTNode;
  content: (string | number)[];
}

export interface AxiomCNode extends CNode {
  cnodetype: CNodeTypes.AXIOM;
  astNode: AxiomASTNode;
  targets: TermOpCNode[];
  assumptions: TermOpCNode[];
  diffArray: string[][];
  diffMap: Map<string, Set<string>>;
}

export interface ThmCNode extends CNode {
  cnodetype: CNodeTypes.THM;
  astNode: ThmASTNode;
  targets: TermOpCNode[];
  assumptions: TermOpCNode[];
  diffArray: string[][];
  diffMap: Map<string, Set<string>>;
  proofs: ProofOpCNode[];
  proofProcess: TermOpCNode[][];
  isValid: Boolean;
  suggestions: Map<string, TermOpCNode>[][];
  suggestionProof: ProofOpCNode[][];
  cNodeSuggestions?: Suggestion[];
}

export interface TermOpCNode {
  root: Token;
  children: TermOpCNode[];
  range: Range;
  definition: TermCNode | ParamPair;
  type: string;
  termContent: string;
  funContent: string;
  virtual?: boolean;
  termTokens?: Token[];
}

export interface ProofOpCNode {
  root: Token;
  children: TermOpCNode[];
  range: Range;
  definition: CNode;
  targets: TermOpCNode[];
  assumptions: TermOpCNode[];
  diffs: Map<string, Set<string>>;
  useVirtual: boolean;
  diffError?: string[];
  virtualEdit?: TextEdit[];
  isUseless?: boolean;
}

export const CONTENT_FILE = 'content.follow.json';

export function getFollowErrorMsg(errorType: ErrorTypes): string {
  switch (errorType) {
    case ErrorTypes.TypeMissing:
      return '类型缺失';
    case ErrorTypes.NameMissing:
      return '名称缺失';
    case ErrorTypes.LeftParenMissing:
      return "左括号'('缺失";
    case ErrorTypes.RightParenMissing:
      return "右括号')'缺失";
    case ErrorTypes.ParamTypeMissing:
      return '变量类型缺失';
    case ErrorTypes.ParamNameMissing:
      return '变量名称缺失';
    case ErrorTypes.LeftBraceMissing:
      return "左大括号'{'缺失";
    case ErrorTypes.RightBraceMissing:
      return "右大括号'}'缺失";
    case ErrorTypes.BodyKeywordMissing:
      return "缺失关键词'|-'，'-|'，或者'diff'";
    case ErrorTypes.EmptyBodyStmt:
      return '空语句';
    case ErrorTypes.EmptyTargetBodyStmt:
      return '空target，`|- <term1> <term2> <term3>`';
    case ErrorTypes.EmptyAssumeBodyStmt:
      return '空assumption，`-| <term1> <term2> <term3>`';
    case ErrorTypes.EmptyDiffBodyStmt:
      return '空diff，`diff (x, y, z) (A, B, C) ...`';
    case ErrorTypes.DupDiff:
      return 'diff不能接受两个相同的符号';
    case ErrorTypes.SingleDiff:
      return 'diff需要至少2个符号';
    case ErrorTypes.DiffNotWord:
      return 'diff只接受argument符号';
    case ErrorTypes.TargetMissing:
      return 'target缺失';
    case ErrorTypes.DupDefType:
      return '类型重复定义';
    case ErrorTypes.TypeDefMissing:
      return '类型未定义';
    case ErrorTypes.NotType:
      return '不是类型';
    case ErrorTypes.DupName:
      return '名字重复';
    case ErrorTypes.DupArgName:
      return '参数名字重复';
    case ErrorTypes.DiffIsKeyword:
      return 'diff是一个关键字';
    case ErrorTypes.DiffIsNotArg:
      return 'diff只接受argument符号';
    case ErrorTypes.TermDefMissing:
      return 'term定义缺失';
    case ErrorTypes.TooManyArg:
      return '参数太多';
    case ErrorTypes.TooLessArg:
      return '参数太少';
    case ErrorTypes.ArgTypeError:
      return '参数类型错误';
    case ErrorTypes.AxiomThmDefMissing:
      return '使用未定义的axiom/thm';
    case ErrorTypes.ProofDiffError:
      return '违反了所使用的axiom/thm的diff条件';
    case ErrorTypes.ProofOpUseless:
      return '无用的证明语句';
    case ErrorTypes.ThmWithoutValidProof:
      return 'thm未证明';
  }
  return '';
}

export type Suggestion = {
  range: Range;
  newText: string;
  doc: string;
  additionalTextEdits?: TextEdit[];
};

export interface CompileInfo {
  cNodes: CNode[];
  errors: Error[];
  tokens: Token[];
  suggestions: Suggestion[];
}

export function cNodeToString(cNode: CNode): string {
  switch (cNode.cnodetype) {
    case CNodeTypes.TYPE:
      const typeNode = cNode as TypeCNode;
      return `type ${typeNode.astNode.types.map((t) => t.content)}`;
    case CNodeTypes.TERM:
      const termNode = cNode as TermCNode;
      if (termNode.astNode.params.length > 0) {
        return [
          'term',
          termNode.astNode.name.content,
          '(',
          termNode.astNode.params.map((param) => param.type.content + ' ' + param.name.content).join(', '),
          ')',
          '{',
          termNode.astNode.content.map((c) => c.content).join(''),
          '}',
        ].join(' ');
      }
      return [
        'term',
        termNode.astNode.name.content,
        '{',
        termNode.astNode.content.map((c) => c.content).join(''),
        '}',
      ].join(' ');

    case CNodeTypes.AXIOM:
      const axiomNode = cNode as AxiomCNode;
      if (axiomNode.diffArray.length > 0) {
        return [
          `axiom ${axiomNode.astNode.name.content}(${axiomNode.astNode.params
            .map((param) => param.type.content + ' ' + param.name.content)
            .join(', ')}) {`,
          ...axiomNode.targets.map((t) => '|- ' + t.termContent),
          ...axiomNode.assumptions.map((a) => '-| ' + a.termContent),
          'diff ' + axiomNode.diffArray.map((group) => '(' + group.join(',') + ')').join(' '),
          '}',
        ].join('\n');
      }
      return [
        `axiom ${axiomNode.astNode.name.content}(${axiomNode.astNode.params
          .map((param) => param.type.content + ' ' + param.name.content)
          .join(', ')}) {`,
        ...axiomNode.targets.map((t) => '|- ' + t.termContent),
        ...axiomNode.assumptions.map((a) => '-| ' + a.termContent),
        '}',
      ].join('\n');
    case CNodeTypes.THM:
      const thmNode = cNode as ThmCNode;
      if (thmNode.diffArray.length > 0) {
        return [
          `thm ${thmNode.astNode.name.content}(${thmNode.astNode.params
            .map((param) => param.type.content + ' ' + param.name.content)
            .join(', ')}) {`,
          ...thmNode.targets.map((t) => '|- ' + t.termContent),
          ...thmNode.assumptions.map((a) => '-| ' + a.termContent),
          'diff ' + thmNode.diffArray.map((group) => '(' + group.join(',') + ')').join(' '),
          '}',
        ].join('\n');
      }
      return [
        `thm ${thmNode.astNode.name.content}(${thmNode.astNode.params
          .map((param) => param.type.content + ' ' + param.name.content)
          .join(', ')}) {`,
        ...thmNode.targets.map((t) => '|- ' + t.termContent),
        ...thmNode.assumptions.map((a) => '-| ' + a.termContent),
        '}',
      ].join('\n');
  }
  return '';
}

export type CNodeInfo = {
  noteId: string;
  blockId: string;
  type: string;
  name: string;
  content: string;
};
