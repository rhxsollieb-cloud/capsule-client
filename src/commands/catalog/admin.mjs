import { text, requiredText, flag, integer } from "./options.mjs";

const page = { limit: integer(1, 100), offset: integer(0, 1000000) };
const revision = { ...integer(0, Number.MAX_SAFE_INTEGER), required: true };
const command = (name, arity, options, help) => ({ name, arity, handler: "admin", options, help });
export const group = {
  id: "admin", title: "身份、权限、审计与备份",
  commands: [
    command("me", [0, 0], {}, "me\n查询当前凭据的个人身份及创建/管理权限，不返回凭据本身。"),
    command("whoami", [0, 0], {}, "whoami\n查询人与Agent共用的CLI登录身份；显式兼容访问令牌优先于保存的登录会话。"),
    command("users", [0, 0], page, "users [--limit 数量 --offset 偏移]\n管理员分页查询用户。"),
    command("user-create", [1, 1], { role: requiredText, enabled: flag, username: text, "password-file": text }, "user-create 名称 --role admin|editor [--username 登录名 --password-file 密码文件或- --enabled=true|false]\n管理员创建用户；editor为普通员工，cap访问由统一三档权限决定。密码只经文件或stdin读取。首次初始化创建启用admin；一次性凭据不支持--fields，预算至少2048或--out。"),
    command("user-update", [1, 1], { revision, name: text, role: text, enabled: flag, username: text, "password-file": text }, "user-update 用户ID --revision 当前修订 [--name 名称 --username 登录名 --password-file 新密码文件或- --role admin|editor --enabled=true|false]\n按读取时revision修改管理员或普通员工；密码重置退出其登录会话，保留兼容维护令牌。冲突先重读。"),
    command("credentials", [0, 0], { "user-id": text, ...page }, "credentials [--user-id 用户ID --limit 数量 --offset 偏移]\n管理员列出凭据登记，不返回token或hash。"),
    command("credential-create", [1, 1], { label: requiredText }, "credential-create 用户ID --label 用途\n管理员签发个人凭据；token只在成功响应中显示一次，不写入客户端全局会话或浏览器存储。不支持--fields；--max-chars至少2048或用--out完整保存（文件权限0600）。"),
    command("credential-revoke", [1, 1], { revision }, "credential-revoke 凭据ID --revision 当前修订\n管理员撤销凭据，不可重新启用；先核对用户与用途。"),
    command("cap-access", [1, 1], { revision: integer(0, Number.MAX_SAFE_INTEGER), permission: text }, "cap-access cap名称 [--revision 当前权限修订 --permission read|edit|none]\n管理员读取或设置该cap全部非管理员权限：read只读且可复制，edit读写，none不可访问；新cap默认edit。权限revision与正文token分开，不支持个人例外。"),
    command("grants", [1, 1], {}, "grants cap名称\ncap-access只读查询的兼容别名，返回统一非管理员权限及revision，不返回个人授权。"),
    command("cap-protect", [1, 1], { revision, protected: flag }, "cap-protect cap名称 --revision 当前权限修订 --protected=true|false\n兼容入口：true设置全部非管理员none，false设置edit；只读权限使用cap-access --permission read。"),
    command("grant-set", [2, 2], { revision, permission: requiredText }, "grant-set（已停用）\n不再支持逐员工授权。请使用cap-access cap名称 --revision 修订 --permission read|edit|none设置全部非管理员权限。"),
    command("audit", [0, 0], { name: text, action: text, outcome: text, ...page }, "audit [--name cap名称 --action 操作 --outcome 结果 --limit 数量 --offset 偏移]\n管理员分页读取带操作者归因的服务端审计。"),
    command("backups", [0, 0], page, "backups [--limit 数量 --offset 偏移]\n管理员列出服务端完整工作区备份。"),
    command("backup-create", [0, 0], { label: text }, "backup-create [--label 说明]\n管理员创建完整服务端备份；请求结果未知时先查询backups，不自动重提。"),
    command("backup-inspect", [1, 1], {}, "backup-inspect 备份ID\n读取备份摘要、校验值和状态。"),
    command("backup-register", [1, 1], { checksum: requiredText }, "backup-register 备份ID --checksum 外存SHA256\n管理员认领已放入服务端配置备份区的离线备份，独立校验后登记；不接收任意路径或上传归档，不覆盖不同校验值记录。"),
    command("backup-download", [2, 2], {}, "backup-download 备份ID 本地文件\n流式下载备份归档，不覆盖已有本地目标。归档可能含敏感数据，请妥善保存。"),
    command("backup-verify", [1, 1], {}, "backup-verify 备份ID\n检查服务端备份完整性，不恢复活动库。"),
    command("backup-restore-preview", [1, 1], {}, "backup-restore-preview 备份ID\n取得隔离恢复预演、previewId、checksum、confirmationName及固定restoreId；不覆盖活动库。"),
    command("backup-restore", [1, 1], { "preview-id": requiredText, checksum: requiredText, "confirmation-name": requiredText }, "backup-restore 备份ID --preview-id 预演ID --checksum 校验值 --confirmation-name 确认名称\n仅恢复到服务端配置的隔离区。使用原预演，结果未知先查backup-receipt，勿重新预演并重放。"),
    command("backup-receipt", [1, 1], {}, "backup-receipt 操作ID\n查询原备份操作回执；恢复ID取自restore-preview，失败的operationId也可用于核对，不重放操作。"),
  ],
};
