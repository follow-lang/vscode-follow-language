import * as charCodes from 'charcodes';
import { Range, Position, Token, TokenTypes, Keywords } from './types';

const separators: Set<number> = new Set([
  charCodes.leftCurlyBrace,
  charCodes.rightCurlyBrace,
  charCodes.leftParenthesis,
  charCodes.rightParenthesis,
  charCodes.comma,
  charCodes.equalsTo,
]);

const isSeparator = (code: number) => {
  return separators.has(code);
};

const keywords: Set<string> = new Set([
  Keywords.TYPE,
  Keywords.TERM,
  Keywords.AXIOM,
  Keywords.THM,
  Keywords.TARGET,
  Keywords.ASSUME,
  Keywords.DIFF,
]);
const isKeyword = (word: string) => {
  return keywords.has(word);
};

export class Scanner {
  private position: PositionImpl;
  private text: string;
  private idx: number;

  constructor() {
    this.position = new PositionImpl(0, 0, 0);
    this.text = '';
    this.idx = 0;
  }
  private reset(text: string) {
    this.position = new PositionImpl(0, 0, 0);
    this.text = text;
    this.idx = 0;
  }

  public scan(text: string): Token[] {
    this.reset(text);
    const tokens: Token[] = [];

    while (this.idx < this.text.length) {
      const code = this.text.charCodeAt(this.idx);
      if (isNewLine(code)) {
        const token = this.getNewLineToken();
        tokens.push(token);
        continue;
      }
      if (this.isIgnore(code)) {
        const token = this.getIgnoreToken();
        tokens.push(token);
        continue;
      }
      if (isSeparator(code)) {
        const token = this.getSeperator();
        tokens.push(token);
        continue;
      }
      if (charCodes.slash) {
        const nextCode = this.text.charCodeAt(this.idx + 1);
        if (nextCode === charCodes.slash) {
          // line comment
          const token = this.getLineComment();
          tokens.push(token);
          continue;
        } else if (nextCode === charCodes.asterisk) {
          // block comment
          const token = this.getBlockComment();
          tokens.push(token);
          continue;
        }
      }
      const token = this.getWord();
      tokens.push(token);
    }
    return tokens;
  }

  private isIgnore(code: number): boolean {
    if (isWhitespace(code) || code === charCodes.carriageReturn) {
      return true;
    }
    return false;
  }
  private getNewLineToken() {
    const startPosition = this.position.clone();
    const startIdx = this.idx;
    this.idxPushForward();
    const endPosition = this.position.clone();
    const content = this.text.slice(startIdx, this.idx);
    const range = new RangeImpl(startPosition, endPosition);
    const token = new TokenImpl(TokenTypes.IGNORE, content, range);
    return token;
  }

  private getIgnoreToken() {
    const startPosition = this.position.clone();
    const startIdx = this.idx;
    let endPosition = startPosition;
    this.idxPushForward();

    while (this.idx < this.text.length) {
      const code = this.text.charCodeAt(this.idx);
      if (!this.isIgnore(code)) {
        break;
      }
      this.idxPushForward();
    }
    endPosition = this.position.clone();
    const content = this.text.slice(startIdx, this.idx);
    const range = new RangeImpl(startPosition, endPosition);

    const token = new TokenImpl(TokenTypes.IGNORE, content, range);
    return token;
  }

  private idxPushForward() {
    const code = this.text.charCodeAt(this.idx);
    this.idx += 1;
    this.position.next(code);
  }

  private getSeperator(): Token {
    const startPosition = this.position.clone();
    const content = this.text.charAt(this.idx);
    this.idxPushForward();
    const endPosition = this.position.clone();
    const range = new RangeImpl(startPosition, endPosition);
    const token = new TokenImpl(TokenTypes.SEP, content, range);
    return token;
  }

  private getWord(): Token {
    const startPosition = this.position.clone();
    const startIdx = this.idx;
    let endPosition = startPosition;
    let endIdx = this.idx;
    this.idxPushForward();

    while (this.idx < this.text.length) {
      const code = this.text.charCodeAt(this.idx);
      if (isWhitespace(code) || isNewLine(code) || code === charCodes.carriageReturn || isSeparator(code)) {
        endPosition = this.position.clone();
        endIdx = this.idx;
        break;
      } else if (code === charCodes.slash) {
        const nextCode = this.text.charCodeAt(this.idx + 1);
        if (nextCode === charCodes.slash || nextCode === charCodes.asterisk) {
          endPosition = this.position.clone();
          endIdx = this.idx;
          break;
        }
      }
      this.idxPushForward();
    }
    if (endIdx === startIdx) {
      // at the end of file
      endPosition = this.position.clone();
      endIdx = this.idx;
    }
    const content = this.text.slice(startIdx, endIdx);
    const range = new RangeImpl(startPosition, endPosition);

    const token = new TokenImpl(isKeyword(content) ? TokenTypes.KEY : TokenTypes.WORD, content, range);
    return token;
  }

  private getLineComment(): Token {
    const startPosition = this.position.clone();
    const startIdx = this.idx;
    let endPosition = startPosition;
    let endIdx = startIdx;

    this.idxPushForward();
    this.idxPushForward();

    while (this.idx < this.text.length) {
      const code = this.text.charCodeAt(this.idx);
      if (isNewLine(code) || code === charCodes.carriageReturn) {
        endPosition = this.position.clone();
        endIdx = this.idx;
        break;
      }
      this.idxPushForward();
    }

    if (endIdx === startIdx) {
      // at the end of file
      endPosition = this.position.clone();
      endIdx = this.idx;
    }
    const content = this.text.slice(startIdx, endIdx);
    const range = new RangeImpl(startPosition, endPosition);
    const token = new TokenImpl(TokenTypes.COMMENT, content, range);
    return token;
  }
  private getBlockComment(): Token {
    const startPosition = this.position.clone();
    const startIdx = this.idx;
    let endPosition = startPosition;
    let endIdx = this.idx;

    this.idxPushForward();
    this.idxPushForward();

    while (this.idx < this.text.length) {
      const code = this.text.charCodeAt(this.idx);
      if (code === charCodes.asterisk) {
        const nextCode = this.text.charCodeAt(this.idx + 1);
        if (nextCode === charCodes.slash) {
          this.idxPushForward();
          this.idxPushForward();
          endPosition = this.position.clone();
          endIdx = this.idx;
          break;
        }
      }
      this.idxPushForward();
    }

    if (endIdx === startIdx) {
      // at the end of file
      endPosition = this.position.clone();
      endIdx = this.idx;
    }
    const content = this.text.slice(startIdx, endIdx);
    const range = new RangeImpl(startPosition, endPosition);
    const token = new TokenImpl(TokenTypes.COMMENT, content, range);
    return token;
  }
}

export class PositionImpl implements Position {
  line: number;
  character: number;
  offset: number;

  constructor(line: number, character: number, offset: number) {
    this.line = line;
    this.character = character;
    this.offset = offset;
  }

  public clone() {
    return new PositionImpl(this.line, this.character, this.offset);
  }

  public next(code: number) {
    if (isNewLine(code)) {
      this.line += 1;
      this.character = 0;
    } else {
      this.character += 1;
    }
    this.offset += 1;
  }

  public toString() {
    return `(${this.line}, ${this.character}, ${this.offset})`;
  }
}

export class RangeImpl implements Range {
  start: Position;
  end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }

  public toString() {
    return `[${this.start.toString()}, ${this.end.toString()}]`;
  }
}

export class TokenImpl implements Token {
  type: TokenTypes;
  content: string;
  range: Range;

  constructor(type: TokenTypes, content: string, range: Range) {
    this.type = type;
    this.content = content;
    this.range = range;
  }

  public toString() {
    return `${this.type} '${this.content}' ${this.range.toString()}`;
  }
}

// babel source code
// https://tc39.github.io/ecma262/#sec-line-terminators
function isNewLine(code: number): boolean {
  switch (code) {
    case charCodes.lineFeed:
    case charCodes.lineSeparator:
    case charCodes.paragraphSeparator:
      return true;
    default:
      return false;
  }
}

// babel source code
// https://tc39.github.io/ecma262/#sec-white-space
function isWhitespace(code: number): boolean {
  switch (code) {
    case 0x0009: // CHARACTER TABULATION
    case 0x000b: // LINE TABULATION
    case 0x000c: // FORM FEED
    case charCodes.space:
    case charCodes.nonBreakingSpace:
    case charCodes.oghamSpaceMark:
    case 0x2000: // EN QUAD
    case 0x2001: // EM QUAD
    case 0x2002: // EN SPACE
    case 0x2003: // EM SPACE
    case 0x2004: // THREE-PER-EM SPACE
    case 0x2005: // FOUR-PER-EM SPACE
    case 0x2006: // SIX-PER-EM SPACE
    case 0x2007: // FIGURE SPACE
    case 0x2008: // PUNCTUATION SPACE
    case 0x2009: // THIN SPACE
    case 0x200a: // HAIR SPACE
    case 0x202f: // NARROW NO-BREAK SPACE
    case 0x205f: // MEDIUM MATHEMATICAL SPACE
    case 0x3000: // IDEOGRAPHIC SPACE
    case 0xfeff: // ZERO WIDTH NO-BREAK SPACE
      return true;

    default:
      return false;
  }
}
