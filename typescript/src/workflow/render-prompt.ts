import type { Issue } from '../spec/index.js';

export interface RenderPromptContext {
  issue: Issue;
  attempt: {
    turnCount: number;
  };
}

const TEMPLATE_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;

function resolveTemplatePath(context: RenderPromptContext, templatePath: string): string | number {
  const segments = templatePath.split('.');
  let current: unknown = context;

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      throw new Error(`unknown template variable: ${templatePath}`);
    }

    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current !== 'string' && typeof current !== 'number') {
    throw new Error(`template value must be string or number: ${templatePath}`);
  }

  return current;
}

export function renderPrompt(template: string, context: RenderPromptContext): string {
  return template.replace(TEMPLATE_PATTERN, (_match, templatePath: string) => {
    return String(resolveTemplatePath(context, templatePath));
  });
}
