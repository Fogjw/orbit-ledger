// 薄转发：真身已搬到 core/（桌面端与纯前端版共用同一套业务规则），这里保留原路径，
// 于是 server 的 api/mcp/bootstrap 与既有 70 项测试都不需要改一行。
export * from '../../../core/services/tagService.js';
