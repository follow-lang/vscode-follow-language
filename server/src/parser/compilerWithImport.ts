import * as path from 'path';
import MarkdownIt from 'markdown-it';

import { Parser } from './parser';
import { RangeImpl, Scanner } from './scanner';
import {
  ASTNode,
  AxiomASTNode,
  AxiomCNode,
  CNode,
  CNodeTypes,
  Error,
  ErrorTypes,
  Keywords,
  NodeTypes,
  OpAstNode,
  TermOpCNode,
  ParamPair,
  TermASTNode,
  TermCNode,
  ThmASTNode,
  Token,
  TypeASTNode,
  TypeCNode,
  ProofOpCNode,
  ThmCNode,
  TokenTypes,
  Suggestion,
  cNodeToString,
  TextEdit,
} from './types';

import CryptoJS from 'crypto-js';

export class CompilerWithImport {
  public cNodeListMap: Map<string, CNode[]> = new Map();
  public cNodeMapMap: Map<string, Map<string, CNode>> = new Map();
  public tokenListMap: Map<string, Token[]> = new Map();
  public errors: Error[] = [];
  public depFileList: string[] = [];
  public currentCNodeList: CNode[] = [];
  public currentCNodeMap: Map<string, CNode> = new Map();
  public currentDeps: string[] = [];
  public currentFile: string = '';
  private virtualIndex = 0;
  private virtualMap: Map<string, TermOpCNode> = new Map();
  private virtualUsedMap: Map<string, TermOpCNode[]> = new Map();

  private markdownCodePosMap: Map<string, { code: string; offset: number }[]> = new Map();
  public markdownCodeMap: Map<string, Map<string, CNode[]>> = new Map();
  public markdownCodeTokensMap: Map<string, Map<string, Token[]>> = new Map();

  public setImportList(importList: string[]) {
    this.depFileList = importList;
  }

  private changeMarkdownFile(filename: string, markdownContent: string) {
    try {
      const md = new MarkdownIt();
      // 编译Markdown
      const tokens = md.parse(markdownContent, {});
      const matches = tokens
        .filter((token) => token.type === 'fence' && token.info.trim() === 'follow')
        .map((token) => ({ code: token.content, position: markdownContent.indexOf(token.content) }));
      let followCode: string = '';
      let preIndex: number = 0;
      const markdownCodeList: {
        code: string;
        offset: number;
      }[] = [];
      for (const match of matches) {
        if (match.position >= preIndex) {
          followCode += markdownContent.slice(preIndex, match.position).replace(/[^\n]/g, ' ');
          followCode += match.code;
          preIndex = match.position + match.code.length;
          markdownCodeList.push({ code: match.code, offset: match.position });
        }
      }
      this.markdownCodePosMap.set(filename, markdownCodeList);
      return followCode;
    } catch (error) {
      console.error('changeMarkdownFile', error);
    }
    return markdownContent;
  }
  private buildMarkdownCodeMap(filename: string) {
    const markdownCodeList = this.markdownCodePosMap.get(filename);
    if (markdownCodeList === undefined) {
      return;
    }
    const cNodeList = this.cNodeListMap.get(filename);
    if (cNodeList === undefined || cNodeList.length === 0) {
      return;
    }
    const tokenList = this.tokenListMap.get(filename);
    if (tokenList === undefined || tokenList.length === 0) {
      return;
    }
    const codeMap: Map<string, CNode[]> = new Map();
    const codeTokensMap: Map<string, Token[]> = new Map();
    for (const { code, offset } of markdownCodeList) {
      const codeMd5 = CryptoJS.MD5(code).toString();
      const cNodes = cNodeList.filter(
        (node) => offset <= node.astNode.range.start.offset && offset + code.length >= node.astNode.range.end.offset,
      );
      if (cNodes.length > 0) {
        codeMap.set(codeMd5, cNodes);
      }
      const tokenStartIndex = tokenList.findIndex((token) => token.range.start.offset >= offset);
      const tokenEndIndex = tokenList.findIndex((token) => token.range.end.offset >= offset + code.length);
      if (tokenStartIndex !== -1) {
        if (tokenEndIndex === -1) {
          codeTokensMap.set(codeMd5, tokenList.slice(tokenStartIndex));
        } else if (tokenStartIndex < tokenEndIndex) {
          codeTokensMap.set(codeMd5, tokenList.slice(tokenStartIndex, tokenEndIndex));
        }
      }
    }
    this.markdownCodeMap.set(filename, codeMap);
    this.markdownCodeTokensMap.set(filename, codeTokensMap);
  }
  public compileCode(filename: string, code: string) {
    code = code.replace(/\r\n/g, '\n');
    const extname = path.extname(filename);
    if (extname === '.md') {
      code = this.changeMarkdownFile(filename, code);
    }
    const scanner = new Scanner();
    const parser = new Parser();
    const tokens = scanner.scan(code);
    this.tokenListMap.set(filename, tokens);
    const astNode = parser.parse(tokens);
    const cNdoes = this.compile(filename, astNode);
    const errors = [...parser.errors, ...this.errors];
    errors.sort((a, b) => {
      if (a.token.range.start.line != b.token.range.start.line) {
        return a.token.range.start.line - b.token.range.start.line;
      } else if (a.token.range.start.character != b.token.range.start.character) {
        return a.token.range.start.character - b.token.range.start.character;
      } else if (a.token.range.end.line != b.token.range.start.line) {
        return a.token.range.end.line - b.token.range.end.line;
      }
      return a.token.range.end.character - b.token.range.end.character;
    });
    if (extname === '.md') {
      this.buildMarkdownCodeMap(filename);
    }
    return {
      cNodes: cNdoes,
      errors: errors,
      tokens: tokens,
    };
  }
  private compile(filename: string, astNode: ASTNode[]): CNode[] {
    const cNodeList: CNode[] = [];
    const cNodeMap: Map<string, CNode> = new Map();
    this.currentCNodeList = cNodeList;
    this.currentCNodeMap = cNodeMap;
    this.currentFile = filename;
    this.cNodeListMap.set(filename, cNodeList);
    this.cNodeMapMap.set(filename, cNodeMap);
    const depIndex = this.depFileList.indexOf(filename);
    if (depIndex >= 0 && depIndex < this.depFileList.length) {
      this.currentDeps = this.depFileList.slice(0, depIndex);
    }
    this.errors = [];
    for (const node of astNode) {
      this.compile0(node);
    }
    return cNodeList;
  }
  private compile0(node: ASTNode) {
    switch (node.nodetype) {
      case NodeTypes.TYPE:
        this.compileTypeBlock(node);
        return;
      case NodeTypes.TERM:
        this.compileTermBlock(node);
        return;
      case NodeTypes.AXIOM:
        this.compileAxiomBlock(node);
        return;
      case NodeTypes.THM:
        this.compileThmBlock(node);
        return;
    }
  }
  private pushCurrentCNodeList(cNode: CNode) {
    this.currentCNodeList.push(cNode);
  }
  private setCurrentCNodeMap(key: string, value: CNode) {
    this.currentCNodeMap.set(key, value);
  }
  private compileTypeBlock(node: TypeASTNode) {
    for (const type of node.types) {
      if (this.checkNameDup(type)) {
        const nodetype: CNodeTypes.TYPE = CNodeTypes.TYPE;
        const cnode: TypeCNode = {
          cnodetype: nodetype,
          astNode: node,
          type: type,
        };
        this.pushCurrentCNodeList(cnode);
        this.setCurrentCNodeMap(type.content, cnode);
      }
    }
  }
  private compileTermBlock(node: TermASTNode) {
    if (!this.checkTypeDef(node.type)) {
      return;
    }
    if (!this.checkNameDup(node.name)) {
      return;
    }
    if (!this.checkParams(node.params)) {
      return;
    }
    const argIndexMap: Map<string, number> = new Map();
    node.params.forEach((p, idx) => {
      argIndexMap.set(p.name.content, idx);
    });
    const content: (string | number)[] = [];
    for (const token of node.content) {
      const index = argIndexMap.get(token.content);
      if (index !== undefined) {
        token.type = TokenTypes.ARGNAME;
        content.push(index);
      } else {
        if (node.params.length === 0) {
          token.type = TokenTypes.CONSTNAME;
        }
        content.push(token.content);
      }
    }
    const termCNode: TermCNode = {
      cnodetype: CNodeTypes.TERM,
      astNode: node,
      content: content,
    };
    this.pushCurrentCNodeList(termCNode);
    this.setCurrentCNodeMap(node.name.content, termCNode);
  }
  private compileAxiomBlock(node: AxiomASTNode) {
    if (!this.checkNameDup(node.name)) {
      return;
    }
    if (!this.checkParams(node.params)) {
      return;
    }
    const argDefMap: Map<string, ParamPair> = new Map();
    node.params.forEach((p) => {
      argDefMap.set(p.name.content, p);
    });

    const targets: TermOpCNode[] = [];
    for (const t of node.targets) {
      const ct = this.compileTermOpNode0(t, argDefMap);
      if (ct === undefined) {
        // Parsing opNode failed.
        return;
      } else {
        targets.push(ct);
        ct.root.comment = ct.termContent;
      }
    }
    const assumptions: TermOpCNode[] = [];
    for (const a of node.assumptions) {
      const ca = this.compileTermOpNode0(a, argDefMap);
      if (ca === undefined) {
        // Parsing opNode failed.
        return;
      } else {
        assumptions.push(ca);
        ca.root.comment = ca.termContent;
      }
    }
    const axiomCNode: AxiomCNode = {
      cnodetype: CNodeTypes.AXIOM,
      astNode: node,
      targets: targets,
      assumptions: assumptions,
      diffArray: node.diffs.map((e) => e.map((e) => e.content)),
      diffMap: this.getDiffMap(node.diffs),
    };

    this.pushCurrentCNodeList(axiomCNode);
    this.setCurrentCNodeMap(node.name.content, axiomCNode);
  }
  private getDiffMap(diffs: Token[][]): Map<string, Set<string>> {
    const rstMap: Map<string, Set<string>> = new Map();
    for (const diffarray of diffs) {
      for (let i = 0; i < diffarray.length - 1; i++) {
        const si = diffarray[i].content;
        for (let j = i + 1; j < diffarray.length; j++) {
          const sj = diffarray[j].content;
          if (si <= sj) {
            let tmpSet = rstMap.get(si);
            if (tmpSet === undefined) {
              tmpSet = new Set();
              rstMap.set(si, tmpSet);
            }
            tmpSet.add(sj);
          } else {
            let tmpSet = rstMap.get(sj);
            if (tmpSet === undefined) {
              tmpSet = new Set();
              rstMap.set(sj, tmpSet);
            }
            tmpSet.add(si);
          }
        }
      }
    }
    return rstMap;
  }
  private compileThmBlock(node: ThmASTNode) {
    if (!this.checkNameDup(node.name)) {
      return;
    }
    if (!this.checkParams(node.params)) {
      return;
    }
    const argDefMap: Map<string, ParamPair> = new Map();
    node.params.forEach((p) => {
      argDefMap.set(p.name.content, p);
    });

    const targets: TermOpCNode[] = [];
    for (const t of node.targets) {
      const ct = this.compileTermOpNode0(t, argDefMap);
      if (ct === undefined) {
        // Parsing opNode failed.
        return;
      } else {
        targets.push(ct);
        ct.root.comment = ct.termContent;
      }
    }
    const assumptions: TermOpCNode[] = [];
    for (const a of node.assumptions) {
      const ca = this.compileTermOpNode0(a, argDefMap);
      if (ca === undefined) {
        // Parsing opNode failed.
        return;
      } else {
        assumptions.push(ca);
        ca.root.comment = ca.termContent;
      }
    }

    this.virtualIndex = 0;
    this.virtualMap = new Map();
    this.virtualUsedMap = new Map();

    const proofs: ProofOpCNode[] = [];
    const diffMap = this.getDiffMap(node.diffs);
    const cNodeSuggestions: Suggestion[] = [];
    for (const opNode of node.proof) {
      const proofOpCNode = this.compileProofOpNode(opNode, argDefMap, diffMap);
      if (proofOpCNode) {
        proofs.push(proofOpCNode);
      } else {
        cNodeSuggestions.push(...this.getProofOpRootSuggestions(opNode.root));
      }
    }
    const { processes, suggestions, suggestionProof } = this.getProofProcess(
      targets,
      proofs,
      assumptions,
      argDefMap,
      diffMap,
    );
    const thmCNode: ThmCNode = {
      cnodetype: CNodeTypes.THM,
      astNode: node,
      assumptions: assumptions,
      targets: targets,
      diffArray: node.diffs.map((e) => e.map((e) => e.content)),
      diffMap: diffMap,
      proofs: proofs,
      proofProcess: processes,
      isValid: this.checkProofValidation(processes.at(-1)),
      suggestions: suggestions,
      suggestionProof: suggestionProof,
      cNodeSuggestions: cNodeSuggestions,
    };
    this.pushCurrentCNodeList(thmCNode);
    this.setCurrentCNodeMap(node.name.content, thmCNode);
    if (!thmCNode.isValid) {
      this.errors.push({
        type: ErrorTypes.ThmWithoutValidProof,
        token: node.name,
      });
    }
  }
  private checkProofValidation(targets: TermOpCNode[] | undefined): Boolean {
    if (targets === undefined) {
      return false;
    }
    if (targets.length === 0) {
      return true;
    }
    return false;
  }
  private getProofProcess(
    targets: TermOpCNode[],
    proofs: ProofOpCNode[],
    assumptions: TermOpCNode[],
    blockArgDefMap: Map<string, ParamPair>,
    targetDiffMap: Map<string, Set<string>>,
  ) {
    const processes: TermOpCNode[][] = [];
    const suggestions: Map<string, TermOpCNode>[][] = [];
    const assumptionSet: Set<string> = new Set(assumptions.map((ass) => ass.funContent));
    const suggestionProof: ProofOpCNode[][] = [];
    let currentTarget = [...targets];
    for (const proof of proofs) {
      // check target
      const nextTarget = this.getNextProof0(currentTarget, proof, assumptionSet);
      if (nextTarget === undefined) {
        this.errors.push({
          type: ErrorTypes.ProofOpUseless,
          token: proof.root,
        });
        proof.isUseless = true;
        processes.push(currentTarget);
        const suggestion = this.getSuggestions(currentTarget, proof, assumptions);
        suggestions.push(suggestion);
        const result = suggestion.map((m) => {
          const proofOpCNode = this.replaceProofCNode(proof, m, blockArgDefMap, targetDiffMap);
          const virtualEdits: TextEdit[] = [];
          this.virtualMap.forEach((value, key) => {
            if (value.range.end.line < proofOpCNode.range.start.line) {
              const virtualTarget = m.get(key);
              if (virtualTarget && virtualTarget.funContent !== value.funContent) {
                virtualEdits.push({
                  range: value.range,
                  newText: virtualTarget.funContent,
                  oldText: value.funContent,
                  newTermText: virtualTarget.termContent,
                });
                this.virtualUsedMap.get(key)?.forEach((cNode) => {
                  virtualEdits.push({
                    range: cNode.range,
                    newText: virtualTarget.funContent,
                    oldText: value.funContent,
                    newTermText: virtualTarget.termContent,
                  });
                });
              }
            }
          });
          proofOpCNode.virtualEdit = virtualEdits;
          return proofOpCNode;
        });
        // 过滤掉没有改变的suggestion
        suggestionProof.push(
          result.filter((newProofOp) => {
            if (newProofOp.virtualEdit && newProofOp.virtualEdit.length > 0) {
              return true;
            }
            for (let i = 0; i < newProofOp.children.length; i++) {
              const child = proof.children[i];
              const newChild = newProofOp.children[i];
              if (child.funContent !== newChild.funContent) {
                return true;
              }
            }
            return false;
          }),
        );
      } else {
        processes.push(nextTarget);
        currentTarget = nextTarget;
        this.setProofComment(proof, nextTarget);
        if (proof.useVirtual) {
          const suggestion = this.getSuggestion2(proof);
          suggestions.push([suggestion]);
          suggestionProof.push([this.replaceProofCNode(proof, suggestion, blockArgDefMap, targetDiffMap)]);
        } else {
          suggestions.push([]);
          suggestionProof.push([]);
        }
      }
    }
    return { processes, suggestions, suggestionProof };
  }
  private setProofComment(proof: ProofOpCNode, currentTarget: TermOpCNode[]) {
    const newTarget = currentTarget.map((t) => '|- ' + t.termContent).join('\n');
    proof.root.comment = `${proof.root.content} => ${newTarget || 'Q.E.D.'}`;
  }
  private checkDiffCondition(
    root: Token,
    targetDiffMap: Map<string, Set<string>>,
    newDiffMap: Map<string, Set<string>>,
    blockArgSet: Set<string>,
  ) {
    if (newDiffMap.size === 0) {
      return [];
    }
    const diffError: string[] = [];
    for (const item of newDiffMap) {
      if (item[1].has(item[0])) {
        this.errors.push({
          type: ErrorTypes.ProofDiffError,
          token: root,
        });
        diffError.push(`(${item[0]},${item[0]})`);
      }
      if (!blockArgSet.has(item[0])) {
        continue;
      }
      const bodyDiff = targetDiffMap.get(item[0]);
      for (const v of item[1]) {
        if (!blockArgSet.has(v)) {
          continue;
        }
        if (bodyDiff === undefined || !bodyDiff.has(v)) {
          this.errors.push({
            type: ErrorTypes.ProofDiffError,
            token: root,
          });
          diffError.push(`(${item[0]},${v})`);
          break;
        }
      }
    }
    return diffError;
  }
  private checkDiffCondition0(
    targetDiffMap: Map<string, Set<string>>,
    newDiffMap: Map<string, Set<string>>,
    blockArgSet: Set<string>,
  ) {
    if (newDiffMap.size === 0) {
      return [];
    }
    const diffError: string[] = [];
    for (const item of newDiffMap) {
      if (item[1].has(item[0])) {
        diffError.push(`(${item[0]},${item[0]})`);
      }
      if (!blockArgSet.has(item[0])) {
        continue;
      }
      const bodyDiff = targetDiffMap.get(item[0]);
      for (const v of item[1]) {
        if (!blockArgSet.has(v)) {
          continue;
        }
        if (bodyDiff === undefined || !bodyDiff.has(v)) {
          diffError.push(`(${item[0]},${v})`);
          break;
        }
      }
    }
    return diffError;
  }

  private getSuggestion2(proof: ProofOpCNode): Map<string, TermOpCNode> {
    const suggestions: Map<string, TermOpCNode> = new Map();
    for (const child of proof.children) {
      if (child.virtual === true) {
        suggestions.set(child.root.content, child);
      }
    }
    return suggestions;
  }

  private suggestionToString(suggestion: Map<string, TermOpCNode>) {
    const keyList = Array.from(suggestion.keys()).sort();
    const s = keyList.map((key) => key + ':' + suggestion.get(key)?.funContent || key).join(';');
    return s;
  }

  private getSuggestions(
    targets: TermOpCNode[],
    proof: ProofOpCNode,
    assumptions: TermOpCNode[],
  ): Map<string, TermOpCNode>[] {
    const suggestions: Map<string, TermOpCNode>[] = [];
    const suggestionSet: Set<string> = new Set();
    // suggestion 的顺序和target的顺序相同体验更好
    console.log('Hello');
    for (const target of targets) {
      const tmpSuggestions: Map<string, TermOpCNode>[] = [];
      for (const current of proof.targets) {
        const suggestion = this.matchTermOpCNode1(current, target);
        if (suggestion) {
          tmpSuggestions.push(suggestion);
          for (const current of proof.assumptions) {
            for (const assumption of assumptions) {
              // 尝试配对一个assumption
              const suggestion2 = this.matchTermOpCNode1(current, assumption, suggestion);
              if (suggestion2 && suggestion2.size > suggestion.size) {
                tmpSuggestions.push(suggestion2);
              }
            }
          }
        }
      }
      tmpSuggestions.sort((a, b) => {
        const virtualA = this.getSuggestionVirtualCount(a);
        const virtualB = this.getSuggestionVirtualCount(b);
        const realA = a.size - virtualA;
        const realB = b.size - virtualB;
        if (realA === realB) {
          return virtualA - virtualB;
        }
        return realB - realA;
      });
      for (const suggestion of tmpSuggestions) {
        const suggestionStr = this.suggestionToString(suggestion);
        if (!suggestionSet.has(suggestionStr)) {
          suggestions.push(suggestion);
          suggestionSet.add(suggestionStr);
        }
      }
    }
    // 整体再排一次序吧，体验好一些
    suggestions.sort((a, b) => {
      const virtualA = this.getSuggestionVirtualCount(a);
      const virtualB = this.getSuggestionVirtualCount(b);
      const realA = a.size - virtualA;
      const realB = b.size - virtualB;
      if (realA === realB) {
        return virtualA - virtualB;
      }
      return realB - realA;
    });
    return suggestions;
  }
  private getSuggestionVirtualCount(suggestion: Map<string, TermOpCNode>) {
    let cnt = 0;
    suggestion.forEach((value, _) => {
      if (value.virtual === true) {
        cnt += 1;
      }
    });
    return cnt;
  }
  private isDep0(parent: string, child: string, dep: Map<string, Set<string>>) {
    const depChild = dep.get(parent);
    if (depChild) {
      if (depChild.has(child)) {
        return true;
      }
      for (const c of depChild) {
        if (this.isDep0(c, child, dep)) {
          return true;
        }
      }
    }
    return false;
  }
  private setDep(parent: string, child: string, dep: Map<string, Set<string>>) {
    const depChild = dep.get(parent);
    if (depChild) {
      depChild.add(child);
    } else {
      dep.set(parent, new Set([child]));
    }
  }
  private isEq(v1: string, v2: string, eq: Set<string>[]) {
    const s = eq.find((s) => s.has(v1));
    return s !== undefined && s.has(v2);
  }
  private checkTreeMatching(
    current: TermOpCNode | undefined,
    target: TermOpCNode | undefined,
    eq: Set<string>[],
    dep: Map<string, Set<string>>,
    preArgMap: Map<string, TermOpCNode>,
  ): Map<string, TermOpCNode> | undefined {
    if (current === undefined || target === undefined) {
      return preArgMap;
    }
    if (current.virtual) {
      if (target.virtual) {
        if (this.isDep0(current.funContent, target.funContent, dep)) {
          return undefined;
        }
        const tmp = this.checkTreeMatching(
          preArgMap.get(current.funContent),
          preArgMap.get(target.funContent),
          eq,
          dep,
          preArgMap,
        );
        if (tmp === undefined) {
          return undefined;
        }

        // 合并 eq 集合
        const currentSetIndex = eq.findIndex((s) => s.has(current.funContent));
        const targetSetIndex = eq.findIndex((s) => s.has(target.funContent));
        if (currentSetIndex === -1 && targetSetIndex === -1) {
          eq.push(new Set([current.funContent, target.funContent]));
        } else if (currentSetIndex === -1) {
          eq[targetSetIndex].add(current.funContent);
        } else if (targetSetIndex === -1) {
          eq[currentSetIndex].add(target.funContent);
        } else if (currentSetIndex !== targetSetIndex) {
          const currentSet = eq[currentSetIndex];
          const targetSet = eq[targetSetIndex];
          eq[currentSetIndex] = new Set([...currentSet, ...targetSet]);
          eq.splice(targetSetIndex, 1);
        }
        return preArgMap;
      }
      const virtuals = this.getVirtualOfTermOpCNode(target);
      for (const v of virtuals) {
        if (this.isEq(current.funContent, v, eq) || this.isDep0(v, current.funContent, dep)) {
          return undefined;
        }
      }
      const oldCNode = preArgMap.get(current.funContent);
      if (oldCNode) {
        const tmp = this.checkTreeMatching(oldCNode, target, eq, dep, preArgMap);
        if (tmp === undefined) {
          return undefined;
        }
      } else {
        preArgMap.set(current.funContent, target);
      }
      for (const v of virtuals) {
        this.setDep(current.funContent, v, dep);
      }
      return preArgMap;
    } else if (target.virtual) {
      const virtuals = this.getVirtualOfTermOpCNode(current);
      for (const v of virtuals) {
        if (this.isEq(target.funContent, v, eq) || this.isDep0(v, target.funContent, dep)) {
          return undefined;
        }
      }
      const oldCNode = preArgMap.get(target.funContent);
      if (oldCNode) {
        const tmp = this.checkTreeMatching(current, oldCNode, eq, dep, preArgMap);
        if (tmp === undefined) {
          return undefined;
        }
      } else {
        preArgMap.set(target.funContent, current);
      }
      for (const v of virtuals) {
        this.setDep(target.funContent, v, dep);
      }
      return preArgMap;
    } else {
      if (current.root.content !== target.root.content) {
        return undefined;
      }
      for (let i = 0; i < current.children.length; i++) {
        const tmp = this.checkTreeMatching(current.children[i], target.children[i], eq, dep, preArgMap);
        if (tmp === undefined) {
          return undefined;
        }
      }
      return preArgMap;
    }
  }
  private matchTermOpCNode1(
    current: TermOpCNode,
    target: TermOpCNode,
    preArgMap?: Map<string, TermOpCNode>,
  ): Map<string, TermOpCNode> | undefined {
    const argMap: Map<string, TermOpCNode> = new Map(preArgMap);
    const eq: Set<string>[] = [];
    const dep: Map<string, Set<string>> = new Map();
    const tmp = this.checkTreeMatching(current, target, eq, dep, argMap);
    if (tmp === undefined) {
      return undefined;
    }
    const argValues = Array.from(argMap.keys());
    argValues.sort((a, b) => {
      if (this.isDep0(b, a, dep)) {
        return -1;
      } else if (this.isEq(b, a, eq)) {
        return 0;
      }
      return 1;
    });
    const virtuals = [...this.getVirtualOfTermOpCNode2(current), ...this.getVirtualOfTermOpCNode2(target)];
    // 在argMap 并且在 eq 中的变量进行统一替换
    for (const k of argValues) {
      const value = argMap.get(k);
      const s = eq.find((s) => s.has(k));
      if (value) {
        const newOpCNode = this.replaceTermOpCNode(value, argMap);
        if (s) {
          for (const newK of s) {
            argMap.set(newK, newOpCNode);
          }
        } else {
          argMap.set(k, newOpCNode);
        }
      } else if (s) {
        // 这里有bug，一定走不到，因为 k 一定在argMap中
        const minS = Array.from(s.values()).sort()[0];
        const virtual = virtuals.find((v) => v.funContent === minS);
        if (virtual) {
          for (const newK of s) {
            argMap.set(newK, virtual);
          }
        }
      }
    }
    // 没有在argMap，但是在eq中的变量进行替换
    for (const vars of eq) {
      const varList = Array.from(vars.values()).sort();
      const head = varList.at(0);
      if (head && !argMap.has(head)) {
        const headToken = virtuals.find((v) => v.funContent === head);
        if (headToken) {
          for (let i = 1; i < varList.length; i++) {
            argMap.set(varList[i], headToken);
          }
        }
      }
    }
    return argMap;
  }

  private getNextProof0(
    targets: TermOpCNode[],
    proof: ProofOpCNode,
    assumptionSet: Set<string>,
  ): TermOpCNode[] | undefined {
    const proofTargetSet = new Set(proof.targets.map((e) => e.funContent));
    let nextTargets: TermOpCNode[] = [];
    let proofSomething = false;
    for (const target of targets) {
      if (proofTargetSet.has(target.funContent)) {
        proofSomething = true;
      } else {
        if (!assumptionSet.has(target.funContent)) {
          nextTargets.push(target);
        }
      }
    }
    if (!proofSomething) {
      return undefined;
    }
    if (proofSomething) {
      // 新的targets放在最前面体验更好
      const nextTargetSet = new Set(nextTargets.map((e) => e.funContent));
      const newTargets = proof.assumptions.filter(
        (assumption) => !assumptionSet.has(assumption.funContent) && !nextTargetSet.has(assumption.funContent),
      );
      nextTargets = [...newTargets, ...nextTargets];
    }
    return nextTargets;
  }
  private getDefinition(name: string): CNode | undefined {
    let definition = this.currentCNodeMap.get(name);
    if (definition) {
      return definition;
    }
    for (const dep of this.currentDeps) {
      const cNodeMap = this.cNodeMapMap.get(dep);
      if (cNodeMap && cNodeMap.has(name)) {
        return cNodeMap.get(name);
      }
    }
    return undefined;
  }
  private getProofOpRootSuggestions(token: Token): Suggestion[] {
    const suggestions: Suggestion[] = [];
    let content = token.content;
    if (content.at(-1) === '.') {
      content = content.slice(0, content.length - 1);
    }
    if (content.length >= 2) {
      for (const cNode of this.currentCNodeList) {
        if (cNode.cnodetype === CNodeTypes.AXIOM || cNode.cnodetype === CNodeTypes.THM) {
          const cNode2 = cNode as ThmCNode | AxiomCNode;
          if (cNode2.astNode.name.content.startsWith(content)) {
            const tmp: Suggestion = {
              range: token.range,
              newText: cNode2.astNode.name.content,
              doc: cNodeToString(cNode),
            };
            suggestions.push(tmp);
          }
        }
      }
      for (const dep of this.currentDeps) {
        const cNodeList = this.cNodeListMap.get(dep);
        if (cNodeList) {
          for (const cNode of cNodeList) {
            if (cNode.cnodetype === CNodeTypes.AXIOM || cNode.cnodetype === CNodeTypes.THM) {
              const cNode2 = cNode as ThmCNode | AxiomCNode;
              if (cNode2.astNode.name.content.startsWith(token.content)) {
                const tmp: Suggestion = {
                  range: token.range,
                  newText: cNode2.astNode.name.content,
                  doc: cNodeToString(cNode),
                };
                suggestions.push(tmp);
              }
            }
          }
        }
      }
    }
    return suggestions.slice(0, 1000);
  }
  private compileProofOpNode(
    opNode: OpAstNode,
    blockArgDefMap: Map<string, ParamPair>,
    targetDiffMap: Map<string, Set<string>>,
  ): ProofOpCNode | undefined {
    const root = opNode.root;
    const definition = this.getDefinition(root.content);
    if (
      definition === undefined ||
      (definition.cnodetype !== CNodeTypes.AXIOM && definition.cnodetype !== CNodeTypes.THM)
    ) {
      this.errors.push({
        type: ErrorTypes.AxiomThmDefMissing,
        token: root,
      });
      return;
    }
    const definition2 = definition as AxiomCNode | ThmCNode;
    const wantArgs = definition2.astNode.params;
    if (wantArgs.length !== opNode.children.length) {
      if (wantArgs.length < opNode.children.length) {
        this.errors.push({
          type: ErrorTypes.TooManyArg,
          token: root,
        });
      } else {
        this.errors.push({
          type: ErrorTypes.TooLessArg,
          token: root,
        });
      }
    }
    if (definition2.cnodetype === CNodeTypes.AXIOM) {
      root.type = TokenTypes.AXIOMNAME;
    } else {
      root.type = TokenTypes.THMNAME;
    }

    const children: TermOpCNode[] = [];
    const argMap: Map<string, TermOpCNode> = new Map();
    let useVirtual = false;
    for (let idx = 0; idx < wantArgs.length; idx++) {
      const wantArg = wantArgs[idx];
      const childOpNode = opNode.children.at(idx);
      if (childOpNode === undefined) {
        const virtualName = this.getNextVirtual(wantArg.type.content);
        const virtualArg: TermOpCNode = {
          root: { ...wantArg.name, content: virtualName },
          children: [],
          range: new RangeImpl(root.range.end, root.range.end),
          definition: wantArg,
          type: wantArg.type.content,
          termContent: virtualName,
          funContent: virtualName,
          virtual: true,
        };
        this.virtualMap.set(virtualArg.funContent, virtualArg);
        this.virtualIndex += 1;
        argMap.set(wantArg.name.content, virtualArg);
        useVirtual = true;
        if (children.length > idx) {
          children[idx] = virtualArg;
        } else {
          children.push(virtualArg);
        }
      } else {
        const childOpCNode = this.compileTermOpNode1(childOpNode, blockArgDefMap, wantArg);
        children.push(childOpCNode);
        if (childOpCNode.virtual) {
          useVirtual = true;
        }
        argMap.set(wantArg.name.content, childOpCNode);
      }
    }

    const targets = definition2.targets.map((e) => this.replaceTermOpCNode(e, argMap));
    const assumptions = definition2.assumptions.map((e) => this.replaceTermOpCNode(e, argMap));
    const blockArgSet: Set<string> = new Set();
    blockArgDefMap.forEach((pair) => blockArgSet.add(pair.name.content));
    const diffs = this.replaceDiffs(definition2.diffArray, argMap);
    const diffErrors = this.checkDiffCondition(root, targetDiffMap, diffs, blockArgSet);

    const proofOpCNode: ProofOpCNode = {
      root: root,
      children: children as TermOpCNode[],
      range: opNode.range,
      definition: definition2,
      targets: targets,
      assumptions: assumptions,
      diffs: diffs,
      useVirtual: useVirtual,
      diffError: diffErrors || undefined,
    };
    return proofOpCNode;
  }
  private replaceDiffs(diffs: string[][], argMap: Map<string, TermOpCNode>): Map<string, Set<string>> {
    if (diffs.length === 0) {
      return new Map();
    }
    const argVars: Map<string, Set<string>> = new Map();
    argMap.forEach((value, key) => {
      const tmp = this.getLeavesOfTermOpCNode(value);
      if (tmp.size > 0) {
        argVars.set(key, tmp);
      }
    });
    const rst: Set<string>[][] = [];
    for (const diffgroup of diffs) {
      const tmp: Set<string>[] = [];
      for (const v of diffgroup) {
        const s = argVars.get(v);
        if (s) {
          tmp.push(s);
        }
      }
      rst.push(tmp);
    }
    const rstMap: Map<string, Set<string>> = new Map();
    for (const diffArray of rst) {
      for (let i = 0; i < diffArray.length - 1; i++) {
        const seti = diffArray[i];
        for (let j = i + 1; j < diffArray.length; j++) {
          const setj = diffArray[j];
          for (const si of seti) {
            for (const sj of setj) {
              if (si <= sj) {
                let tmpSet = rstMap.get(si);
                if (tmpSet === undefined) {
                  tmpSet = new Set();
                  rstMap.set(si, tmpSet);
                }
                tmpSet.add(sj);
              } else {
                let tmpSet = rstMap.get(sj);
                if (tmpSet === undefined) {
                  tmpSet = new Set();
                  rstMap.set(sj, tmpSet);
                }
                tmpSet.add(si);
              }
            }
          }
        }
      }
    }
    return rstMap;
  }

  private getVirtualOfTermOpCNode2(term: TermOpCNode): TermOpCNode[] {
    if (term.virtual) {
      return [term];
    }
    const rst: TermOpCNode[] = [];
    for (const child of term.children) {
      rst.push(...this.getVirtualOfTermOpCNode2(child));
    }
    return rst;
  }

  private getVirtualOfTermOpCNode(term: TermOpCNode): Set<string> {
    if (term.virtual) {
      return new Set([term.funContent]);
    }
    const rst: string[] = [];
    for (const child of term.children) {
      rst.push(...this.getVirtualOfTermOpCNode(child));
    }
    return new Set(rst);
  }
  private getLeavesOfTermOpCNode(term: TermOpCNode): Set<string> {
    if (term.children.length === 0) {
      // 这里之前有bug，只返回了arg参数
      return new Set([term.funContent]);
    }
    const rst: string[] = [];
    for (const child of term.children) {
      rst.push(...this.getLeavesOfTermOpCNode(child));
    }
    return new Set(rst);
  }
  public replaceProofCNode(
    proof: ProofOpCNode,
    suggestion: Map<string, TermOpCNode>,
    blockArgDefMap: Map<string, ParamPair>,
    targetDiffMap: Map<string, Set<string>>,
  ): ProofOpCNode {
    const children = proof.children;
    const newChildren: TermOpCNode[] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const newChild = this.replaceTermOpCNode(child, suggestion);
      newChildren.push(newChild);
    }

    const targets = proof.targets.map((e) => this.replaceTermOpCNode(e, suggestion));
    const assumptions = proof.assumptions.map((e) => this.replaceTermOpCNode(e, suggestion));
    const diffs = this.replaceDiffs2(proof.diffs, suggestion);

    const blockArgSet: Set<string> = new Set();
    blockArgDefMap.forEach((pair) => blockArgSet.add(pair.name.content));
    const diffErrors = this.checkDiffCondition0(targetDiffMap, diffs, blockArgSet);

    const newProof = {
      ...proof,
      children: newChildren,
      targets,
      assumptions,
      diffs,
      diffErrors,
    };
    return newProof;
  }
  private replaceTermOpCNode(cNode: TermOpCNode, argMap: Map<string, TermOpCNode>): TermOpCNode {
    const root = cNode.root;
    const definition = cNode.definition;

    const termOpCNode = argMap.get(cNode.funContent);
    if (termOpCNode) {
      // argument
      return termOpCNode;
    }
    if (cNode.children.length === 0) {
      return cNode;
    }

    const children = cNode.children.map((e) => this.replaceTermOpCNode(e, argMap));
    const definition2 = definition as TermCNode;
    const opCNode: TermOpCNode = {
      root: root,
      children: children as TermOpCNode[],
      range: cNode.range,
      definition: definition2,
      type: cNode.type,
      termContent: this.getTermContent(definition2, children),
      funContent: this.getFunContent(definition2, children),
      termTokens: this.getTermToken(definition2, children),
    };
    return opCNode;
  }
  private getNextVirtual(content: string) {
    while (this.virtualMap.has(`?${content}${this.virtualIndex}`)) {
      this.virtualIndex += 1;
    }
    return `?${content}${this.virtualIndex}`;
  }
  public replaceDiffs2(diffs: Map<string, Set<string>>, argMap: Map<string, TermOpCNode>) {
    if (diffs.size === 0) {
      return new Map();
    }
    const argVars: Map<string, Set<string>> = new Map();
    argMap.forEach((value, key) => {
      const tmp = this.getLeavesOfTermOpCNode(value);
      if (tmp.size > 0) {
        argVars.set(key, tmp);
      }
    });
    const rstMap: Map<string, Set<string>> = new Map();
    diffs.forEach((value, key) => {
      const seti = argVars.get(key);
      if (seti) {
        for (const v of value) {
          const setj = argVars.get(v);
          if (setj) {
            for (const si of seti) {
              for (const sj of setj) {
                if (si <= sj) {
                  let tmpSet = rstMap.get(si);
                  if (tmpSet === undefined) {
                    tmpSet = new Set();
                    rstMap.set(si, tmpSet);
                  }
                  tmpSet.add(sj);
                } else {
                  let tmpSet = rstMap.get(sj);
                  if (tmpSet === undefined) {
                    tmpSet = new Set();
                    rstMap.set(sj, tmpSet);
                  }
                  tmpSet.add(si);
                }
              }
            }
          }
        }
      }
    });
    return rstMap;
  }
  private compileTermOpNode1(opNode: OpAstNode, argDefMap: Map<string, ParamPair>, wantArg: ParamPair): TermOpCNode {
    const root = opNode.root;
    // arg
    const argDef = argDefMap.get(root.content);
    if (argDef !== undefined) {
      root.type = TokenTypes.ARGNAME;
      if (opNode.children.length > 0) {
        this.errors.push({
          type: ErrorTypes.TooManyArg,
          token: root,
        });
      }
      const opCNode: TermOpCNode = {
        root: opNode.root,
        children: [],
        range: opNode.range,
        definition: argDef,
        type: argDef.type.content,
        termContent: argDef.name.content,
        funContent: argDef.name.content,
      };
      return opCNode;
    }
    // virtual
    const virtual = this.virtualMap.get(root.content);
    if (virtual) {
      if (virtual.type === wantArg.type.content) {
        if (opNode.children.length > 0) {
          this.errors.push({
            type: ErrorTypes.TooManyArg,
            token: root,
          });
        }
        const opCNode: TermOpCNode = {
          root: root,
          children: [],
          range: opNode.range,
          definition: virtual.definition,
          type: virtual.type,
          termContent: virtual.termContent,
          funContent: virtual.funContent,
          virtual: true,
        };
        let virtualUsed = this.virtualUsedMap.get(virtual.funContent);
        if (virtualUsed === undefined) {
          virtualUsed = [opCNode];
          this.virtualUsedMap.set(virtual.funContent, virtualUsed);
        } else {
          virtualUsed.push(opCNode);
        }
        return opCNode;
      }
    }
    // term
    const definition = this.getDefinition(root.content);
    if (definition === undefined) {
      this.errors.push({
        type: ErrorTypes.TermDefMissing,
        token: root,
      });
      const opCNode: TermOpCNode = {
        root: root,
        children: [],
        range: opNode.range,
        definition: wantArg,
        type: wantArg.type.content,
        termContent: root.content,
        funContent: root.content,
        virtual: true,
      };
      this.virtualMap.set(opCNode.funContent, opCNode);
      this.virtualIndex += 1;
      return opCNode;
    } else if (definition.cnodetype !== CNodeTypes.TERM) {
      this.errors.push({
        type: ErrorTypes.TypeMissing,
        token: root,
      });
      const virturalName = this.getNextVirtual(wantArg.type.content);
      const opCNode: TermOpCNode = {
        root: { ...root, content: virturalName },
        children: [],
        range: opNode.range,
        definition: wantArg,
        type: wantArg.type.content,
        termContent: virturalName,
        funContent: virturalName,
        virtual: true,
      };
      this.virtualMap.set(opCNode.funContent, opCNode);
      return opCNode;
    }

    const definition2 = definition as TermCNode;
    if (definition2.astNode.type.content !== wantArg.type.content) {
      this.errors.push({
        type: ErrorTypes.TypeMissing,
        token: root,
      });
      const virturalName = this.getNextVirtual(wantArg.type.content);
      const opCNode: TermOpCNode = {
        root: { ...root, content: virturalName },
        children: [],
        range: opNode.range,
        definition: wantArg,
        type: wantArg.type.content,
        termContent: virturalName,
        funContent: virturalName,
        virtual: true,
      };
      this.virtualMap.set(opCNode.funContent, opCNode);
      this.virtualIndex += 1;
      return opCNode;
    }
    const wantArgs = definition2.astNode.params;
    if (wantArgs.length !== opNode.children.length) {
      if (wantArgs.length < opNode.children.length) {
        this.errors.push({
          type: ErrorTypes.TooManyArg,
          token: root,
        });
      } else {
        this.errors.push({
          type: ErrorTypes.TooLessArg,
          token: root,
        });
      }
      const virturalName = this.getNextVirtual(wantArg.type.content);
      const opCNode: TermOpCNode = {
        root: { ...root, content: virturalName },
        children: [],
        range: opNode.range,
        definition: wantArg,
        type: wantArg.type.content,
        termContent: virturalName,
        funContent: virturalName,
        virtual: true,
      };
      this.virtualMap.set(opCNode.funContent, opCNode);
      this.virtualIndex += 1;
      return opCNode;
    }
    if (wantArgs.length === 0) {
      root.type = TokenTypes.CONSTNAME;
    } else {
      root.type = TokenTypes.TERMNAME;
    }
    const children = [];
    let useVirutal = false;
    for (let idx = 0; idx < wantArgs.length; idx++) {
      const wantArg = wantArgs[idx];
      const child = opNode.children.at(idx);
      if (child === undefined) {
        const virtualName = this.getNextVirtual(wantArg.type.content);
        const virtualArg: TermOpCNode = {
          root: { ...wantArg.name, content: virtualName },
          children: [],
          range: new RangeImpl(root.range.end, root.range.end),
          definition: wantArg,
          type: wantArg.type.content,
          termContent: virtualName,
          funContent: virtualName,
          virtual: true,
        };
        this.virtualMap.set(virtualArg.funContent, virtualArg);
        this.virtualIndex += 1;
        useVirutal = true;
        children.push(virtualArg);
      } else {
        const opCNode = this.compileTermOpNode1(child, argDefMap, wantArg);
        children.push(opCNode);
      }
    }
    const opCNode: TermOpCNode = {
      root: root,
      children: children as TermOpCNode[],
      range: opNode.range,
      definition: definition2,
      type: definition2.astNode.type.content,
      termContent: this.getTermContent(definition2, children as TermOpCNode[]),
      funContent: this.getFunContent(definition2, children as TermOpCNode[]),
      termTokens: this.getTermToken(definition2, children as TermOpCNode[]),
      virtual: useVirutal,
    };
    return opCNode;
  }

  private compileTermOpNode0(opNode: OpAstNode, argDefMap: Map<string, ParamPair>): TermOpCNode | undefined {
    const root = opNode.root;
    // arg
    const argDef = argDefMap.get(root.content);
    if (argDef !== undefined) {
      root.type = TokenTypes.ARGNAME;
      if (opNode.children.length > 0) {
        this.errors.push({
          type: ErrorTypes.TooManyArg,
          token: root,
        });
        return;
      }
      const opCNode: TermOpCNode = {
        root: opNode.root,
        children: [],
        range: opNode.range,
        definition: argDef,
        type: argDef.type.content,
        termContent: argDef.name.content,
        funContent: argDef.name.content,
      };
      return opCNode;
    }
    // term
    const definition = this.getDefinition(root.content);
    if (definition === undefined || definition.cnodetype !== CNodeTypes.TERM) {
      this.errors.push({
        type: ErrorTypes.TermDefMissing,
        token: root,
      });
      return undefined;
    }
    const definition2 = definition as TermCNode;
    const wantArgs = definition2.astNode.params;
    if (wantArgs.length !== opNode.children.length) {
      if (wantArgs.length < opNode.children.length) {
        this.errors.push({
          type: ErrorTypes.TooManyArg,
          token: root,
        });
      } else {
        this.errors.push({
          type: ErrorTypes.TooLessArg,
          token: root,
        });
      }
      return;
    }
    if (wantArgs.length === 0) {
      root.type = TokenTypes.CONSTNAME;
    } else {
      root.type = TokenTypes.TERMNAME;
    }
    const children: (TermOpCNode | undefined)[] = opNode.children.map((c) => this.compileTermOpNode0(c, argDefMap));
    for (let idx = 0; idx < children.length; idx++) {
      const opCNode = children[idx];
      const wantArg = wantArgs[idx];
      if (opCNode === undefined || wantArg.type.content !== opCNode.type) {
        this.errors.push({
          type: ErrorTypes.ArgTypeError,
          token: root,
        });
        return;
      }
    }
    const opCNode: TermOpCNode = {
      root: root,
      children: children as TermOpCNode[],
      range: opNode.range,
      definition: definition2,
      type: definition2.astNode.type.content,
      termContent: this.getTermContent(definition2, children as TermOpCNode[]),
      funContent: this.getFunContent(definition2, children as TermOpCNode[]),
      termTokens: this.getTermToken(definition2, children as TermOpCNode[]),
    };
    return opCNode;
  }
  private getTermContent(term: TermCNode, children: TermOpCNode[]): string {
    let s: string = '';
    for (let i = 0; i < term.content.length; i++) {
      const word = term.content[i];
      if (typeof word === 'string') {
        s += word;
      } else {
        s += children[word].termContent;
      }
    }
    return s;
  }
  private getTermToken(term: TermCNode, children: TermOpCNode[]): Token[] {
    const result: Token[] = [];
    for (let i = 0; i < term.content.length; i++) {
      const word = term.content[i];
      if (typeof word === 'string') {
        result.push(term.astNode.content[i]);
      } else {
        const tokens = children[word].termTokens;
        if (tokens) {
          result.push(...tokens);
        } else {
          result.push(children[word].root);
        }
      }
    }
    return result;
  }
  private getFunContent(term: TermCNode, children: TermOpCNode[]): string {
    let s: string = term.astNode.name.content;
    if (children.length > 0) {
      s += '(' + children.map((c) => c.funContent).join(',') + ')';
    }
    return s;
  }
  private checkTypeDef(token: Token): boolean {
    const defToken = this.getDefinition(token.content);
    if (defToken === undefined) {
      this.errors.push({
        type: ErrorTypes.TypeDefMissing,
        token: token,
      });
      return false;
    } else if (defToken.cnodetype != CNodeTypes.TYPE) {
      this.errors.push({
        type: ErrorTypes.NotType,
        token: token,
      });
      return false;
    }
    return true;
  }
  private checkNameDup(token: Token): boolean {
    if (Keywords.DIFF === token.content) {
      this.errors.push({
        type: ErrorTypes.DiffIsKeyword,
        token: token,
      });
      return false;
    }

    const defToken = this.getDefinition(token.content);
    if (defToken) {
      this.errors.push({
        type: ErrorTypes.DupName,
        token: token,
      });
      return false;
    }
    return true;
  }
  private checkParams(params: ParamPair[]): boolean {
    const paramSet: Set<string> = new Set();
    for (const param of params) {
      if (!this.checkTypeDef(param.type)) {
        return false;
      } else if (!this.checkNameDup(param.name)) {
        return false;
      } else if (paramSet.has(param.name.content)) {
        this.errors.push({
          type: ErrorTypes.DupArgName,
          token: param.name,
        });
        return false;
      }
      paramSet.add(param.name.content);
    }
    return true;
  }
}
