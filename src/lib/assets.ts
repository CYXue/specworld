// 资源路径：必须跟着部署前缀走（Toy 挂在 /toy/<slug>/ 下）。
// BASE_URL 由 Vite 根据 base:'./' 注入，dev 与产物一致。

export function asset(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  const clean = path.replace(/^\/+/, '');
  return `${base}${clean}`;
}

export function spriteUrl(id: string): string {
  return asset(`sprites/${id}.svg`);
}
