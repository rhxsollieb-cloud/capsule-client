import { SaxesParser } from "saxes";
import { limits, previewError } from "./limits.mjs";

// Format libraries own Office interpretation; this pass only limits XML resources.
export function validateXml(source) {
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let nodes = 0;
  parser.on("doctype", () => { throw previewError("办公文件不接受 DTD"); });
  parser.on("opentag", (tag) => {
    if (++nodes > limits.xmlNodes || ++depth > limits.xmlDepth)
      throw previewError("办公文件 XML 结构超过上限", 413);
    if (tag.local === "Relationship") {
      const attributes = Object.fromEntries(Object.values(tag.attributes).map((attr) => [attr.local, attr.value]));
      if (attributes.TargetMode === "External" && /\/worksheet$/.test(attributes.Type || ""))
        throw previewError("Excel 工作表不能引用外部内容");
    }
  });
  parser.on("closetag", () => { depth--; });
  try {
    parser.write(source).close();
  } catch (error) {
    if (error.status) throw error;
    throw previewError("办公文件 XML 无效");
  }
}
