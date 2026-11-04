export type TypeStyle = { color: string; label: string; icon: string };

const TYPES: Record<string, TypeStyle> = {
  institution: { color: '#2563eb', label: 'Institution', icon: '🏫' },
  department: { color: '#0d9488', label: 'Department', icon: '🏛️' },
  faculty: { color: '#8b5cf6', label: 'Faculty', icon: '👩‍🏫' },
  course: { color: '#4f6df5', label: 'Course', icon: '📚' },
  student: { color: '#10b981', label: 'Student', icon: '🎓' },
  skill: { color: '#f59e0b', label: 'Skill', icon: '⚡' },
  project: { color: '#7c3aed', label: 'Project', icon: '🧩' },
  company: { color: '#db2777', label: 'Company', icon: '🏢' },
  job: { color: '#f97316', label: 'Job', icon: '💼' },
  placement: { color: '#ef4444', label: 'Placement', icon: '🎯' },
  concept: { color: '#64748b', label: 'Concept', icon: '💡' },
};

const EXTRA = ['#0891b2', '#65a30d', '#c026d3', '#ca8a04', '#0284c7', '#e11d48', '#4d7c0f', '#9333ea'];

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function typeStyle(type: string): TypeStyle {
  const known = TYPES[type];
  if (known) return known;
  const label = type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/[_-]/g, ' ') : 'Other';
  return { color: EXTRA[hash(type) % EXTRA.length], label, icon: '◆' };
}

export function relationLabel(type: string) {
  return type.replace(/[_-]+/g, ' ');
}
