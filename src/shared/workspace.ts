export interface DirEntry {
  name: string;
  relativePath: string;
  kind: 'file' | 'dir';
}
