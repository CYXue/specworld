// 站点身份信息：仓库地址、许可证名称、上游项目。
//
// 为什么单独抽一个文件：这三样东西会被页脚和关于页**同时**用到。
// 同一个值写两份、改名时只改一处 —— 那就是「同一条判据写两份」，
// 漏改的那份会静默指向旧地址（站点照常渲染，零报错）。
// 要改名（例如仓库改名）时只改这里。

/** 源码仓库。 */
export const REPO_URL = 'https://github.com/CYXue/specworld';

/** 仓库内许可证文件（相对仓库根）。 */
export const LICENSE_PATH = 'LICENSE';

/** 本项目代码与数据产物的许可证。 */
export const CODE_LICENSE = 'MIT';
