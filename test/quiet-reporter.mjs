export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type === "test:fail")
      yield `${event.data.name}\n${event.data.details?.error?.stack || event.data.details?.error || "测试失败"}\n`;
    else if (event.type === "test:pass" && (event.data.skip || event.data.todo))
      yield `未执行：${event.data.name}（${event.data.skip || event.data.todo}）\n`;
    else if (event.type === "test:stderr" && event.data.message)
      yield event.data.message;
  }
}
