import { requiredText } from "./options.mjs";

const command = (name, arity, options, help) => ({ name, arity, options, help, handler: "leases" });
export const group = { id: "leases", title: "编辑占用", commands: [
  command("lease-status", [1, 1], {}, "lease-status cap名称\n查询当前占用人及到期时间；读取不占用，不返回凭证。"),
  command("lease-acquire", [1, 1], { id: requiredText, scope: requiredText }, "lease-acquire cap名称 --id 客户端UUID --scope content|details|database|office\n立即获取20秒编辑占用，同id幂等；记录返回lease.token，后续写用--lease或CAPSULE_LEASE_TOKEN，每5秒续租。不要使用--fields；一次编辑结束立即release。"),
  command("lease-renew", [1, 1], { id: requiredText }, "lease-renew cap名称 --id 原UUID [--lease 凭证]\n使用原凭证续租；也可从CAPSULE_LEASE_TOKEN取得凭证。过期后不能复活，保留草稿、重新获取并核对原token。"),
  command("lease-release", [1, 1], { id: requiredText }, "lease-release cap名称 --id 原UUID [--lease 凭证]\n立即释放自己的编辑占用，可安全重复；旧release不会释放新id。异常退出最多20秒到期，释放不提交或丢弃草稿。"),
] };
