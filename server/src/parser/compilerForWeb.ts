import { Compiler } from "./compiler";
import {
  AxiomCNode,
  CNode,
  cNodeToString,
  CNodeTypes,
  CNodeInfo,
  CompileInfo,
  TermCNode,
  ThmCNode,
  TypeCNode,
} from "./types";

type NoteId = string;
type BlockId = string;

export class CompilerForWeb {
  public compilerMap: Map<NoteId, Map<BlockId, Compiler>> = new Map();
  public noteIdList: NoteId[] = [];
  public blockIdListMap: Map<NoteId, BlockId[]> = new Map();

  public setNoteIdList(noteIdList: NoteId[]) {
    this.noteIdList = noteIdList;
  }
  public setBlockIdList(noteId: NoteId, blockIds: BlockId[]) {
    this.blockIdListMap.set(noteId, blockIds);
  }
  public compileCode(
    noteId: string,
    blockId: string,
    code: string
  ): CompileInfo {
    let noteMap = this.compilerMap.get(noteId);
    if (noteMap === undefined) {
      noteMap = new Map();
      this.compilerMap.set(noteId, noteMap);
    }
    let compiler = noteMap.get(blockId);
    if (compiler === undefined) {
      compiler = new Compiler(
        this.definitionFinderGenerator(
          noteId,
          blockId,
          this.noteIdList,
          this.blockIdListMap
        ),
        this.axiomThmSearchGenerator(
          noteId,
          blockId,
          this.noteIdList,
          this.blockIdListMap
        )
      );
      noteMap.set(blockId, compiler);
    }
    return compiler.compileCode(code);
  }
  public getErrors(noteId: string, blockId: string) {
    return this.compilerMap.get(noteId)?.get(blockId)?.errors || [];
  }
  public getCNodes(noteId: string, blockId: string) {
    return this.compilerMap.get(noteId)?.get(blockId)?.cNodeList || [];
  }
  public getAllOfCNodes() {
    const result: CNodeInfo[] = [];
    for (const noteId of this.noteIdList) {
      this.blockIdListMap.get(noteId)?.forEach((blockId) => {
        const cNodes = this.getCNodes(noteId, blockId);
        cNodes.forEach((cNode) => {
          const infos = this.getCNodeInfo(noteId, blockId, cNode);
          result.push(...infos);
        });
      });
    }
    return result;
  }
  private getCNodeInfo(
    noteId: string,
    blockId: string,
    cNode: CNode
  ): CNodeInfo[] {
    switch (cNode.cnodetype) {
      case CNodeTypes.TYPE:
        const typeNode = cNode as TypeCNode;
        const typeInfos = typeNode.astNode.types.map((t) => {
          return {
            noteId: noteId,
            blockId: blockId,
            type: "type",
            name: t.content,
            content: `type ${t.content}`,
          };
        });
        return typeInfos;
      case CNodeTypes.TERM:
        const termNode = cNode as TermCNode;
        const termInfo = {
          noteId: noteId,
          blockId: blockId,
          type: "term",
          name: termNode.astNode.name.content,
          content: cNodeToString(cNode),
        };
        return [termInfo];
      case CNodeTypes.AXIOM:
        const axiomNode = cNode as AxiomCNode;
        const axiomInfo = {
          noteId: noteId,
          blockId: blockId,
          type: "axiom",
          name: axiomNode.astNode.name.content,
          content: cNodeToString(cNode),
        };
        return [axiomInfo];
      case CNodeTypes.THM:
        const thmNode = cNode as ThmCNode;
        const thmInfo = {
          noteId: noteId,
          blockId: blockId,
          type: "thm",
          name: thmNode.astNode.name.content,
          content: cNodeToString(cNode),
        };
        return [thmInfo];
    }
    return [];
  }
  private axiomThmSearchGenerator(
    noteId: string,
    blockId: string,
    noteIdList: NoteId[],
    blockIdListMap: Map<NoteId, BlockId[]>
  ) {
    const finder = (name: string) => {
      if (name.length < 3) {
        return [];
      }
      const rst: CNode[] = [];
      const noteIndex = noteIdList.indexOf(noteId);
      if (noteIndex > 0 && noteIndex < this.noteIdList.length) {
        const preNoteIds = noteIdList.slice(0, noteIndex);
        for (const preNoteId of preNoteIds) {
          const blockIds = blockIdListMap.get(preNoteId);
          if (blockIds) {
            for (const blockId of blockIds) {
              this.compilerMap
                .get(preNoteId)
                ?.get(blockId)
                ?.cNodeMap.forEach((cNode, key) => {
                  if (
                    (cNode.cnodetype === CNodeTypes.AXIOM ||
                      cNode.cnodetype === CNodeTypes.THM) &&
                    key.startsWith(name)
                  ) {
                    rst.push(cNode);
                  }
                });
            }
          }
        }
      }
      const blockList = blockIdListMap.get(noteId);
      if (blockList) {
        const blockIndex = blockList.indexOf(blockId);
        for (const blockId of blockList.slice(0, blockIndex)) {
          this.compilerMap
            .get(noteId)
            ?.get(blockId)
            ?.cNodeMap.forEach((cNode, key) => {
              if (
                (cNode.cnodetype === CNodeTypes.AXIOM ||
                  cNode.cnodetype === CNodeTypes.THM) &&
                key.startsWith(name)
              ) {
                rst.push(cNode);
              }
            });
        }
      }
      return rst.slice(0, 10);
    };
    return finder;
  }
  private definitionFinderGenerator(
    noteId: string,
    blockId: string,
    noteIdList: NoteId[],
    blockIdListMap: Map<NoteId, BlockId[]>
  ) {
    const finder = (name: string) => {
      const noteIndex = noteIdList.indexOf(noteId);
      if (noteIndex > 0 && noteIndex < this.noteIdList.length) {
        const preNoteIds = noteIdList.slice(0, noteIndex);
        for (const preNoteId of preNoteIds) {
          const blockIds = blockIdListMap.get(preNoteId);
          if (blockIds) {
            for (const blockId of blockIds) {
              const rst = this.compilerMap
                .get(preNoteId)
                ?.get(blockId)
                ?.cNodeMap.get(name);
              if (rst) {
                return rst;
              }
            }
          }
        }
      }
      const blockList = blockIdListMap.get(noteId);
      if (blockList) {
        const blockIndex = blockList.indexOf(blockId);
        for (const blockId of blockList.slice(0, blockIndex)) {
          const rst = this.compilerMap
            .get(noteId)
            ?.get(blockId)
            ?.cNodeMap.get(name);
          if (rst) {
            return rst;
          }
        }
      }
      return undefined;
    };
    return finder;
  }
}
