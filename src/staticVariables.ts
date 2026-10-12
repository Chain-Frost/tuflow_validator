/**
 * Expand only variables whose literal value is already known from an
 * unconditional Set Variable command. Runtime ~s/~e tokens, expressions,
 * undefined names and cycles deliberately remain unresolved.
 */
export function expandStaticVariables(
    value: string,
    variables: ReadonlyMap<string, string>
): string | null {
    const seen = new Set<string>();
    let current = value;
    for (let i = 0; i < 16; i++) {
        if (!current.includes('<<') && !current.includes('>>')) {
            return current;
        }
        if (seen.has(current)) {
            return null;
        }
        seen.add(current);
        let unknown = false;
        const replaced = current.replace(/<<([^<>]+)>>/g, (token, rawName: string) => {
            const name = rawName.trim().toUpperCase();
            const replacement = variables.get(name);
            if (/^~[SE][1-9]~$/.test(name) || replacement === undefined) {
                unknown = true;
                return token;
            }
            return replacement;
        });
        if (unknown || replaced === current) {
            return null;
        }
        current = replaced;
    }
    return null;
}

/** Do not assume the active branch of a runtime TUFLOW conditional. */
export function applyStaticVariableDefinition(
    key: string,
    value: string,
    inConditional: boolean,
    variables: Map<string, string>
): void {
    const match = /^SET\s+VARIABLE\s+(.+)$/i.exec(key.trim());
    if (!match) {
        return;
    }
    const name = match[1].trim().toUpperCase();
    if (!name) {
        return;
    }
    if (inConditional || /\$math\s*\(/i.test(value)) {
        variables.delete(name);
        return;
    }
    const expanded = expandStaticVariables(value.trim(), variables);
    if (expanded === null || /[\r\n]/.test(expanded)) {
        variables.delete(name);
    } else {
        variables.set(name, expanded);
    }
}
