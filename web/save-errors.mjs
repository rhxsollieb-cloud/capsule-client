export function saveErrorRecord(error) {
  return {
    message: error.message || "保存失败",
    ...(typeof error.status === "number" ? { status: error.status } : {}),
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(typeof error.eventId === "string" ? { eventId: error.eventId } : {}),
    ...(error.uncertain ? { uncertain: true } : {}),
  };
}

export function saveErrorPresentation(error, { remote = false } = {}) {
  const receipt = error?.eventId ? `原事件：${error.eventId}。` : "";
  if (remote || error?.code === "VERSION_CONFLICT") return {
    state: "conflict", label: "版本冲突",
    message: `服务端已有新版本，草稿和原基线已保留。请重新读取并核对后保存。${receipt}`,
  };
  if (error?.code === "LOCK_BUSY") return {
    state: "error", label: "内容处理中",
    message: `内容正被其他操作处理，草稿和原基线已保留。请先查询胶囊活动，等待原操作结果后再保存。${receipt}`,
  };
  if (error?.code === "EVENT_BUSY") return {
    state: "error", label: "已有待处理事件",
    message: `胶囊已有待处理事件，草稿和原基线已保留。${receipt}请先查询原事件与胶囊活动，不要重复提交。`,
  };
  if (error?.code === "WORKSPACE_BUSY") return {
    state: "error", label: "工作区被占用",
    message: `服务端工作区被其他实例占用，草稿和原基线已保留。请核对服务端实例与工作区状态。${receipt}`,
  };
  if (error?.uncertain) return {
    state: "error", label: "保存结果未确认",
    message: `保存结果尚未确认，草稿和原基线已保留。${receipt}请先查询活动及实际状态，不要重复提交。`,
  };
  return {
    state: "error", label: "保存失败",
    message: `保存失败，草稿和原基线已保留。请先查看活动及服务端状态。${receipt}`,
  };
}
