import micromatch from "micromatch";

export class ExcludeFilter {
  constructor(private readonly patterns: string[]) {}

  isExcluded(path: string): boolean {
    if (this.patterns.length === 0) {
      return false;
    }
    if (this.patterns.some((pattern) => pattern.endsWith("/**") && path.startsWith(pattern.slice(0, -3)))) {
      return true;
    }
    return micromatch.isMatch(path, this.patterns, { basename: true, dot: true });
  }
}
