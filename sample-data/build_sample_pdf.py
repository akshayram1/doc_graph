"""Build a sample placement report the Finsk uploader can turn into a graph."""

from pathlib import Path

from reportlab.lib.colors import Color, white
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

NAVY = Color(0.08, 0.16, 0.28)
TEAL = Color(0.12, 0.42, 0.48)
INK = Color(0.12, 0.13, 0.15)
MUTED = Color(0.32, 0.36, 0.42)

OUT = Path(__file__).with_name("northbridge-placement-report.pdf")


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, letter[1] - 36, letter[0], 36, fill=1, stroke=0)
    canvas.setFillColor(white)
    canvas.setFont("Times-Bold", 9)
    canvas.drawString(54, letter[1] - 23, "Northbridge Institute of Technology")
    canvas.setFont("Times-Roman", 9)
    canvas.drawRightString(letter[0] - 54, letter[1] - 23, "Placement Report 2025-26")
    canvas.setFillColor(TEAL)
    canvas.rect(0, 0, letter[0], 28, fill=1, stroke=0)
    canvas.setFillColor(white)
    canvas.setFont("Times-Roman", 8)
    canvas.drawString(54, 11, "Sample document for knowledge-graph ingestion")
    canvas.drawRightString(letter[0] - 54, 11, f"Page {doc.page}")
    canvas.restoreState()


def styles():
    return {
        "title": ParagraphStyle(
            "Title",
            fontName="Times-Bold",
            fontSize=22,
            leading=26,
            textColor=NAVY,
            spaceAfter=6,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            fontName="Times-Italic",
            fontSize=11,
            leading=15,
            textColor=TEAL,
            spaceAfter=14,
        ),
        "h1": ParagraphStyle(
            "H1",
            fontName="Times-Bold",
            fontSize=13,
            leading=16,
            textColor=NAVY,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "h2": ParagraphStyle(
            "H2",
            fontName="Times-Bold",
            fontSize=11.5,
            leading=14,
            textColor=TEAL,
            spaceBefore=6,
            spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "Body",
            fontName="Times-Roman",
            fontSize=10.5,
            leading=14,
            textColor=INK,
            alignment=TA_JUSTIFY,
            spaceAfter=6,
        ),
        "note": ParagraphStyle(
            "Note",
            fontName="Times-Italic",
            fontSize=9,
            leading=12,
            textColor=MUTED,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
    }


SECTIONS = [
    (
        "title",
        "Campus Placement Report",
    ),
    (
        "subtitle",
        "Northbridge Institute of Technology, Academic Year 2025-26. "
        "Departments, faculty, courses, students, skills, companies, and offers.",
    ),
    (
        "note",
        "This is fictional sample data written so an uploader can extract people, "
        "courses, skills, companies, and the links between them.",
    ),
    ("h1", "1. Departments"),
    (
        "body",
        "The Department of Computer Science is part of Northbridge Institute of Technology. "
        "It offers the courses Data Structures (CS101), Machine Learning (ML401), and "
        "Full Stack Development (CS310). The department focuses on software engineering, "
        "data, and applied artificial intelligence.",
    ),
    (
        "body",
        "The Department of Electronics and Communication is part of Northbridge Institute "
        "of Technology. It offers the course Embedded Systems (EE210). The department "
        "focuses on hardware, firmware, and device programming.",
    ),
    (
        "body",
        "The Training and Placement Cell is part of Northbridge Institute of Technology. "
        "The cell coordinates campus recruitment with Google, Microsoft, Razorpay, and "
        "Texas Instruments.",
    ),
    ("h1", "2. Faculty"),
    (
        "body",
        "Dr. Ananya Rao is a faculty member in the Department of Computer Science. "
        "She teaches Machine Learning (ML401). She leads the Campus Knowledge Graph project. "
        "Her research skill is machine learning.",
    ),
    (
        "body",
        "Prof. Vikram Shah is a faculty member in the Department of Computer Science. "
        "He teaches Data Structures (CS101). He advises the Placement Portal project. "
        "His teaching skill is algorithms.",
    ),
    (
        "body",
        "Dr. Meera Iyer is a faculty member in the Department of Electronics and "
        "Communication. She teaches Embedded Systems (EE210). She mentors firmware "
        "internships. Her teaching skill is embedded C.",
    ),
    ("h1", "3. Courses and skills"),
    (
        "body",
        "Data Structures (CS101) is a course in the Department of Computer Science. "
        "Prof. Vikram Shah teaches Data Structures. The course requires the skills "
        "algorithms and Python. Students who complete it can apply for software engineer roles.",
    ),
    (
        "body",
        "Machine Learning (ML401) is a course in the Department of Computer Science. "
        "Dr. Ananya Rao teaches Machine Learning. The course requires the skills Python "
        "and machine learning. It is part of the Campus Knowledge Graph project.",
    ),
    (
        "body",
        "Full Stack Development (CS310) is a course in the Department of Computer Science. "
        "The course requires the skills JavaScript and React. It is part of the Placement "
        "Portal project.",
    ),
    (
        "body",
        "Embedded Systems (EE210) is a course in the Department of Electronics and "
        "Communication. Dr. Meera Iyer teaches Embedded Systems. The course requires the "
        "skill embedded C.",
    ),
    ("h1", "4. Students"),
    (
        "h2",
        "Hassan Ali",
    ),
    (
        "body",
        "Hassan Ali is a student in the Department of Computer Science. Hassan Ali is "
        "enrolled in Data Structures (CS101) and Machine Learning (ML401). Hassan Ali has "
        "the skills Python, machine learning, and algorithms. Hassan Ali works on the "
        "Campus Knowledge Graph project. Hassan Ali received a placement at Google as a "
        "Machine Learning Engineer.",
    ),
    (
        "h2",
        "Priya Nair",
    ),
    (
        "body",
        "Priya Nair is a student in the Department of Computer Science. Priya Nair is "
        "enrolled in Data Structures (CS101) and Full Stack Development (CS310). Priya Nair "
        "has the skills JavaScript, React, and Python. Priya Nair works on the Placement "
        "Portal project. Priya Nair received a placement at Microsoft as a Software Engineer.",
    ),
    (
        "h2",
        "Arjun Mehta",
    ),
    (
        "body",
        "Arjun Mehta is a student in the Department of Electronics and Communication. "
        "Arjun Mehta is enrolled in Embedded Systems (EE210). Arjun Mehta has the skill "
        "embedded C. Arjun Mehta received a placement at Texas Instruments as a Firmware Engineer.",
    ),
    (
        "h2",
        "Sana Qureshi",
    ),
    (
        "body",
        "Sana Qureshi is a student in the Department of Computer Science. Sana Qureshi is "
        "enrolled in Machine Learning (ML401) and Full Stack Development (CS310). Sana "
        "Qureshi has the skills Python, machine learning, and React. Sana Qureshi works on "
        "the Campus Knowledge Graph project. Sana Qureshi received a placement at Razorpay "
        "as a Backend Engineer.",
    ),
    ("h1", "5. Companies, jobs, and placements"),
    (
        "body",
        "Google is a company recruiting through the Training and Placement Cell. The job "
        "Machine Learning Engineer at Google requires the skills Python and machine learning. "
        "The placement of Hassan Ali is a Machine Learning Engineer role at Google. The "
        "offer is part of the 2025-26 campus drive.",
    ),
    (
        "body",
        "Microsoft is a company recruiting through the Training and Placement Cell. The job "
        "Software Engineer at Microsoft requires the skills algorithms, Python, and data "
        "structures. The placement of Priya Nair is a Software Engineer role at Microsoft.",
    ),
    (
        "body",
        "Razorpay is a company recruiting through the Training and Placement Cell. The job "
        "Backend Engineer at Razorpay requires the skills Python and JavaScript. The "
        "placement of Sana Qureshi is a Backend Engineer role at Razorpay.",
    ),
    (
        "body",
        "Texas Instruments is a company recruiting through the Training and Placement Cell. "
        "The job Firmware Engineer at Texas Instruments requires the skill embedded C. The "
        "placement of Arjun Mehta is a Firmware Engineer role at Texas Instruments.",
    ),
    ("h1", "6. Projects"),
    (
        "body",
        "Campus Knowledge Graph is a project in the Department of Computer Science. "
        "Dr. Ananya Rao leads the project. Hassan Ali and Sana Qureshi work on the project. "
        "The project requires the skills Python and machine learning. The project is part "
        "of the course Machine Learning (ML401).",
    ),
    (
        "body",
        "Placement Portal is a project in the Department of Computer Science, built for the "
        "Training and Placement Cell. Prof. Vikram Shah advises the project. Priya Nair "
        "works on the project. The project requires the skills JavaScript and React. The "
        "project is part of the course Full Stack Development (CS310).",
    ),
]


def main() -> None:
    s = styles()
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.72 * inch,
        bottomMargin=0.55 * inch,
        title="Northbridge Institute of Technology Placement Report 2025-26",
        author="Finsk sample data",
    )
    story = [Spacer(1, 8)]
    index = 0
    while index < len(SECTIONS):
        kind, text = SECTIONS[index]
        if (
            kind == "h1"
            and index + 2 < len(SECTIONS)
            and SECTIONS[index + 1][0] == "h2"
            and SECTIONS[index + 2][0] == "body"
        ):
            story.append(
                KeepTogether(
                    [
                        Paragraph(text, s["h1"]),
                        Paragraph(SECTIONS[index + 1][1], s["h2"]),
                        Paragraph(SECTIONS[index + 2][1], s["body"]),
                    ]
                )
            )
            index += 3
            continue
        if kind == "h2" and index + 1 < len(SECTIONS) and SECTIONS[index + 1][0] == "body":
            story.append(
                KeepTogether(
                    [
                        Paragraph(text, s["h2"]),
                        Paragraph(SECTIONS[index + 1][1], s["body"]),
                    ]
                )
            )
            index += 2
            continue
        story.append(Paragraph(text, s[kind]))
        if kind == "title":
            story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceAfter=8))
        index += 1
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(OUT)


if __name__ == "__main__":
    main()
