import fs from 'node:fs/promises'
import path from 'node:path'

const DIRS = ['characters', 'plots']

interface TemplateFile {
  name: string
  content: (projectName: string) => string
}

const FILES: TemplateFile[] = [
  {
    name: 'structure.md',
    content: (name) =>
      `# ${name} — Story Structure\n\nOutline the overall story arc, chapters, and key plot points.\n`
  },
  {
    name: 'genesis.md',
    content: (name) =>
      `# ${name} — Genesis\n\nRecord the origin of this project: inspiration, themes, and goals.\n`
  },
  {
    name: 'style-guide.md',
    content: (name) =>
      `# ${name} — Style Guide\n\nDefine the visual style: color palette, character design notes, panel conventions.\n`
  },
  {
    name: 'AGENTS.md',
    content: (name) =>
      `# ${name} — Agent Instructions\n\nInstructions for AI agents working on this project.\n\n## Project Context\n\nThis is a webtoon project managed by PlotToon.\n\n## Conventions\n\n- Keep cuts.json as the canonical source of truth for each plot.\n- Place generated images in the plot assets folder.\n- Do not modify exported files directly.\n`
  },
  {
    name: '.publish-status.json',
    content: () => JSON.stringify({ published: false, lastCheck: null }, null, 2) + '\n'
  }
]

export async function scaffoldProjectTemplate(
  projectRoot: string,
  projectName: string
): Promise<string[]> {
  const created: string[] = []

  for (const dir of DIRS) {
    const dirPath = path.join(projectRoot, dir)
    await fs.mkdir(dirPath, { recursive: true })
    created.push(dir + '/')
  }

  for (const file of FILES) {
    const filePath = path.join(projectRoot, file.name)
    await fs.writeFile(filePath, file.content(projectName), 'utf-8')
    created.push(file.name)
  }

  return created
}

export function getExpectedTemplatePaths(): string[] {
  return [...DIRS.map((d) => d + '/'), ...FILES.map((f) => f.name)]
}
