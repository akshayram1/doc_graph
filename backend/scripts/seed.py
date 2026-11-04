"""University synthetic data seed for Finsk.

Generates a realistic university knowledge graph with students, courses,
skills, faculty, companies, jobs, placements, and departments, then
upserts dense + sparse (BM25) embeddings into Qdrant with typed
relations in the payload.

Run:
    python scripts/seed.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import NodeInput, Relation
from app.services import registry
from app.services.store import fetch_graph, upsert_nodes

SEED_GRAPH_ID = "university-seed"

COURSES = {
    "cs101": ("Intro to Computer Science", [
        "students", "python", "algorithms", "programming-basics", "git",
    ]),
    "cs201": ("Data Structures and Algorithms", [
        "students", "python", "c++", "algorithms", "dsa", "recursion",
        "complexity-analysis",
    ]),
    "cs202": ("Object-Oriented Programming", [
        "students", "java", "oop", "inheritance", "polymorphism",
    ]),
    "cs301": ("Database Systems", [
        "students", "sql", "postgres", "transactions", "indexing",
    ]),
    "cs302": ("Machine Learning", [
        "students", "python", "numpy", "pandas", "scikit-learn",
        "linear-algebra", "statistics",
    ]),
    "cs303": ("Web Development", [
        "students", "react", "javascript", "html-css", "nextjs",
        "rest-api", "tailwind",
    ]),
    "cs401": ("Distributed Systems", [
        "students", "python", "system-design", "consistency",
        "fault-tolerance", "kafka",
    ]),
    "cs402": ("Natural Language Processing", [
        "students", "python", "transformers", "bert", "nlp",
        "pytorch", "language-models",
    ]),
    "math101": ("Calculus I", [
        "students", "mathematics", "derivatives", "integrals",
        "limits", "optimization",
    ]),
    "math102": ("Discrete Mathematics", [
        "students", "mathematics", "logic", "proofs", "graph-theory",
        "combinatorics",
    ]),
    "ds101": ("Statistics and Probability", [
        "students", "mathematics", "probability", "distributions",
        "hypothesis-testing", "r",
    ]),
    "ee201": ("Digital Logic and Computer Organization", [
        "students", "computer-architecture", "boolean-algebra",
        "logic-gates", "asm",
    ]),
}

SKILLS = list(set(s for _, skills in COURSES.values() for s in skills))

FACULTY = {
    "dr-smith": ("Dr. Alice Smith", "Computer Science", [
        "cs101", "cs201", "cs401",
    ]),
    "dr-johnson": ("Dr. Bob Johnson", "Computer Science", [
        "cs301", "cs402",
    ]),
    "dr-williams": ("Dr. Carol Williams", "Computer Science", [
        "cs302", "cs303",
    ]),
    "dr-brown": ("Dr. Dave Brown", "Mathematics", [
        "math101", "math102",
    ]),
    "dr-davis": ("Dr. Eve Davis", "Statistics", [
        "ds101",
    ]),
    "dr-miller": ("Dr. Frank Miller", "Computer Science", [
        "cs202", "ee201",
    ]),
}

DEPARTMENTS = [
    ("cs-dept", "Computer Science", [
        "cs101", "cs201", "cs202", "cs301", "cs302", "cs303",
        "cs401", "cs402",
    ]),
    ("math-dept", "Mathematics", ["math101", "math102"]),
    ("stats-dept", "Statistics", ["ds101"]),
    ("ee-dept", "Electrical Engineering", ["ee201"]),
]

COMPANIES = {
    "google": ("Google", ["ai", "search", "cloud"]),
    "microsoft": ("Microsoft", ["cloud", "enterprise", "ai"]),
    "amazon": ("Amazon", ["ecommerce", "cloud", "logistics"]),
    "meta": ("Meta", ["social", "vr-ar", "ai"]),
    "apple": ("Apple", ["mobile", "hardware", "software"]),
    "startups": ("TechStart Inc.", ["software", "ai", "fintech"]),
}

JOBS = {
    "job-swe": ("Software Engineer", "google", [
        "python", "java", "react", "javascript", "git", "sql",
        "system-design", "dsa",
    ]),
    "job-ml": ("Machine Learning Engineer", "google", [
        "python", "numpy", "pandas", "scikit-learn", "statistics",
        "linear-algebra", "ml", "pytorch",
    ]),
    "job-sre": ("Site Reliability Engineer", "amazon", [
        "linux", "python", "system-design", "docker", "kubernetes",
        "bash", "monitoring",
    ]),
    "job-fe": ("Frontend Engineer", "meta", [
        "react", "javascript", "html-css", "nextjs", "tailwind",
        "typescript", "ui-ux",
    ]),
    "job-data": ("Data Engineer", "microsoft", [
        "sql", "python", "postgres", "pandas", "etl",
        "spark", "data-pipelines",
    ]),
    "job-mobile": ("Mobile Engineer", "apple", [
        "swift", "kotlin", "oop", "mobile", "ui-ux",
        "rest-api",
    ]),
    "job-nlp": ("NLP Researcher", "startups", [
        "python", "transformers", "bert", "nlp", "pytorch",
        "language-models", "ml",
    ]),
}

STUDENTS = [
    ("alice-chen", "Alice Chen", 8.7, ["python", "java", "react", "javascript", "git", "sql", "dsa", "system-design"]),
    ("bob-garcia", "Bob Garcia", 7.9, ["python", "numpy", "pandas", "scikit-learn", "sql", "statistics", "ml"]),
    ("carol-lee", "Carol Lee", 9.1, ["python", "java", "react", "nextjs", "tailwind", "rest-api", "javascript", "html-css"]),
    ("david-kim", "David Kim", 8.3, ["python", "c++", "dsa", "algorithms", "recursion", "complexity-analysis", "sql"]),
    ("eva-martinez", "Eva Martinez", 7.5, ["java", "oop", "inheritance", "polymorphism", "sql", "postgres"]),
    ("frank-wong", "Frank Wong", 8.9, ["python", "transformers", "bert", "nlp", "pytorch", "language-models", "ml", "linear-algebra"]),
    ("grace-taylor", "Grace Taylor", 7.2, ["javascript", "html-css", "react", "git", "linux", "docker"]),
    ("hassan-ali", "Hassan Ali", 9.3, ["python", "c++", "dsa", "algorithms", "system-design", "java", "sql", "statistics"]),
]

PLACEMENTS = [
    ("alice-chen", "job-swe", "2025-08-15", 156000),
    ("bob-garcia", "job-ml", "2025-08-20", 142000),
    ("carol-lee", "job-fe", "2025-07-10", 138000),
    ("david-kim", "job-swe", "2025-06-30", 148000),
    ("frank-wong", "job-nlp", "2025-08-01", 165000),
    ("hassan-ali", "job-ml", "2025-08-25", 170000),
]


def build_nodes() -> list[NodeInput]:
    nodes: list[NodeInput] = []

    for dept_key, dept_name, course_keys in DEPARTMENTS:
        text = (
            f"{dept_name} is an academic department at the university. "
            f"It offers courses including {', '.join(COURSES[k][0] for k in course_keys)}."
        )
        rels = [Relation(target=k, type="offers") for k in course_keys]
        nodes.append(NodeInput(
            key=dept_key, label=dept_name, type="department",
            text=text, relations=rels,
        ))

    for skill in SKILLS:
        label = skill.replace("-", " ").title()
        text = f"{label} is a technical skill relevant to multiple courses and roles."
        nodes.append(NodeInput(
            key=skill, label=label, type="skill",
            text=text,
        ))

    for course_key, (course_name, skill_keys) in COURSES.items():
        text = (
            f"{course_name} (course code {course_key}) covers "
            f"the following topics: {', '.join(s.replace('-', ' ') for s in skill_keys)}. "
            "Prerequisites vary by program. Students completing this course "
            "gain practical experience through assignments and projects."
        )
        rels = [Relation(target=s, type="teaches") for s in skill_keys]
        nodes.append(NodeInput(
            key=course_key, label=course_name, type="course",
            text=text, relations=rels,
        ))

    for faculty_key, (faculty_name, dept, course_keys) in FACULTY.items():
        text = (
            f"{faculty_name} is a faculty member in the {dept} department. "
            f"They teach {', '.join(COURSES[k][0] for k in course_keys)}."
        )
        rels = [
            Relation(target=dept.lower().replace(" ", "-") + "-dept", type="works_in"),
            *[Relation(target=k, type="teaches") for k in course_keys],
        ]
        nodes.append(NodeInput(
            key=faculty_key, label=faculty_name, type="faculty",
            text=text, relations=rels,
        ))

    for student_key, student_name, cgpa, skill_keys in STUDENTS:
        text = (
            f"{student_name} is a student with a CGPA of {cgpa}. "
            f"Their skills include {', '.join(s.replace('-', ' ') for s in skill_keys)}."
        )
        rels = [
            Relation(target="cs-dept", type="studies_at"),
            *[Relation(target=s, type="has_skill") for s in skill_keys],
        ]
        nodes.append(NodeInput(
            key=student_key, label=f"{student_name}", type="student",
            text=text, relations=rels,
        ))

    for company_key, (company_name, industries) in COMPANIES.items():
        text = (
            f"{company_name} operates in the {', '.join(industries)} industries. "
            "It offers full-time roles and internships to university students."
        )
        nodes.append(NodeInput(
            key=company_key, label=company_name, type="company",
            text=text,
        ))

    for job_key, (job_title, company_key, skill_keys) in JOBS.items():
        company_name = COMPANIES[company_key][0]
        text = (
            f"The {job_title} role at {company_name} requires skills in "
            f"{', '.join(s.replace('-', ' ') for s in skill_keys)}. "
            "This is a full-time position suitable for senior students."
        )
        rels = [
            Relation(target=company_key, type="offered_by"),
            *[Relation(target=s, type="requires") for s in skill_keys],
        ]
        nodes.append(NodeInput(
            key=job_key, label=job_title, type="job",
            text=text, relations=rels,
        ))

    for student_key, job_key, date, salary in PLACEMENTS:
        student_name = next(s[1] for s in STUDENTS if s[0] == student_key)
        job_title = JOBS[job_key][0]
        company_name = COMPANIES[JOBS[job_key][1]][0]
        placement_key = f"placement-{student_key}-{job_key}"
        text = (
            f"{student_name} was placed at {company_name} as a {job_title} "
            f"on {date} with an annual package of ${salary:,}."
        )
        rels = [
            Relation(target=student_key, type="student"),
            Relation(target=job_key, type="job"),
        ]
        nodes.append(NodeInput(
            key=placement_key, label=f"{job_title} @ {company_name}",
            type="placement", text=text, relations=rels,
        ))

    return nodes


def main() -> None:
    nodes = build_nodes()
    ingested = upsert_nodes(nodes, SEED_GRAPH_ID)
    if registry.get_graph(SEED_GRAPH_ID) is None:
        edges = len(fetch_graph(ingested + 10, [SEED_GRAPH_ID]).edges)
        registry.create_graph(
            name="University seed data",
            filename="scripts/seed.py",
            node_count=ingested,
            edge_count=edges,
            graph_id=SEED_GRAPH_ID,
        )
    print(f"Seeded {ingested} nodes into Qdrant as graph '{SEED_GRAPH_ID}'")


if __name__ == "__main__":
    main()
