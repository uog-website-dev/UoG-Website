export function mediaCategories(value: string): string[] {
  return [...new Map(value.split(",").map(v => v.trim()).filter(Boolean).map(v => [v.toLocaleLowerCase(), v])).values()];
}

export function mediaBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
