import { Compiler } from "./compiler";

type FileName = string;

export class CompilerWithImportV2 {
  public compilerMap: Map<FileName, Compiler> = new Map();
  public depFileList: string[] = [];
  public setImportList(depFileList: string[]) {
    this.depFileList = depFileList;
    for(const dep of depFileList) {
      this.compilerMap.set(dep, new Compiler(this.definitionFinderGenerator(dep)))
    }
  }
  public compileCode(filename: string, code: string) {
    let compiler = this.compilerMap.get(filename);
    if (compiler === undefined) {
      compiler = new Compiler(this.definitionFinderGenerator(filename));
      this.compilerMap.set(filename, compiler);
    }
    return compiler.compileCode(code);
  }
  public getErrors(filename: string) {
    return this.compilerMap.get(filename)?.errors || [];
  }
  public getCNodes(filename: string) {
    return this.compilerMap.get(filename)?.cNodeList || [];
  }
  private definitionFinderGenerator(filename: string) {
    const depIndex = this.depFileList.indexOf(filename);
    if (depIndex >= 0 && depIndex < this.depFileList.length) {
      const currentDeps = this.depFileList.slice(0, depIndex);
      const finder = (name: string) => {
        for (const dep of currentDeps) {
          const rst = this.compilerMap.get(dep)?.cNodeMap.get(name);
          if (rst) {
            return rst;
          }
        }
        return undefined;
      };
      return finder;
    }
    return undefined;
  }
}
