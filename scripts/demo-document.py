"""Create the local Word fixture with the bundled Python runtime."""

import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


def create_document(destination):
    document = Document()
    section = document.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = section.bottom_margin = Inches(0.75)
    section.left_margin = section.right_margin = Inches(0.8)
    for style_name in ["Normal", "Title", "Heading 1", "Heading 2"]:
        style = document.styles[style_name]
        style.font.name = "Liberation Sans"
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Liberation Sans")
    normal = document.styles["Normal"]
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(8)
    normal.paragraph_format.line_spacing = 1.2
    document.add_paragraph("拍摄执行说明", "Title")
    document.add_paragraph("开发样例  山野短片  版本 01")
    document.add_paragraph(
        "这份说明用于体验知识库中的 Word 阅读视图。示例计划围绕一支 30 秒山野短片，"
        "说明镜头、收音和交付要求。所有安排均为演示数据，不代表真实拍摄任务。"
    )
    document.add_heading("画面与节奏", 1)
    document.add_paragraph(
        "先用远景建立空间，再以中景交代行进方向，最后用细节镜头收束。"
        "保持自然光，优先选择稳定、缓慢的移动，让素材之间容易衔接。"
    )
    document.add_heading("镜头安排", 1)
    table = document.add_table(rows=1, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    widths = [0.7, 2.0, 1.2, 2.7]
    for column, width in zip(table.columns, widths):
        column.width = Inches(width)
    rows = [
        ["编号", "画面", "时长", "记录要求"],
        ["S01", "山脊远景", "8 秒", "保留 2 秒头尾，避免快速摇摄"],
        ["S02", "步道中景", "10 秒", "沿同一方向移动，保持主体位置"],
        ["S03", "岩石与叶片", "6 秒", "录制环境声，保留自然变化"],
        ["S04", "湖面收尾", "6 秒", "固定机位，等待波纹进入画面"],
    ]
    for index, values in enumerate(rows):
        cells = table.rows[0].cells if index == 0 else table.add_row().cells
        for column, value in enumerate(values):
            cell = cells[column]
            cell.width = Inches(widths[column])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.text = value
            properties = cell._tc.get_or_add_tcPr()
            borders = OxmlElement("w:tcBorders")
            for edge in ["top", "left", "bottom", "right"]:
                border = OxmlElement(f"w:{edge}")
                border.set(qn("w:val"), "single")
                border.set(qn("w:sz"), "4")
                border.set(qn("w:color"), "D9D9D9")
                borders.append(border)
            properties.append(borders)
            margin = OxmlElement("w:tcMar")
            for edge in ["top", "left", "bottom", "right"]:
                item = OxmlElement(f"w:{edge}")
                item.set(qn("w:w"), "90")
                item.set(qn("w:type"), "dxa")
                margin.append(item)
            properties.append(margin)
            if index == 0 or index % 2 == 0:
                shade = OxmlElement("w:shd")
                shade.set(qn("w:fill"), "E9EDF1" if index == 0 else "F6F7F8")
                properties.append(shade)
            if index == 0:
                for run in cell.paragraphs[0].runs:
                    run.bold = True
    document.add_paragraph()
    document.add_heading("声音与交付", 1)
    document.add_paragraph(
        "每个场景单独录制不少于 10 秒的环境声。演示用提示音是离线合成的正弦波，"
        "仅用于检查音频播放器。原始素材保持各自格式，说明与媒体通过虚拟路径组织。"
    )
    document.add_paragraph("交付清单：四组镜头、环境声、剪辑版本和镜头记录。")
    document.core_properties.title = "拍摄执行说明"
    document.core_properties.subject = "胶囊知识库开发样例"
    document.core_properties.author = "Capsule 示例"
    # Remove inherited decorative title rules and theme font overrides.
    for tree in [document.element, document.styles.element]:
        for border in list(tree.iter(qn("w:pBdr"))):
            border.getparent().remove(border)
        for fonts in tree.iter(qn("w:rFonts")):
            for attribute in ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]:
                fonts.attrib.pop(qn(f"w:{attribute}"), None)
            for attribute in ["ascii", "hAnsi", "eastAsia", "cs"]:
                fonts.set(qn(f"w:{attribute}"), "Liberation Sans")
    for paragraph in document.paragraphs:
        for run in paragraph.runs:
            run.font.name = "Liberation Sans"
            run.font.color.rgb = RGBColor(0, 0, 0)
            run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Liberation Sans")
    document.save(destination)


if __name__ == "__main__":
    target = Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    create_document(target)
