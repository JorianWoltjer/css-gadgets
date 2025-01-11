import path from 'path';


export function outputFilename(input, suffix) {
    const name = path.basename(input, '.css');
    return path.join(path.dirname(input), `${name}-${suffix}`);
}
export function ensureNoDuplicates(properties) {
    const seen = new Set();
    for (const property of properties) {
        if (seen.has(property.name)) {
            throw new Error(`'${property.name}:' is defined twice in property constraints`);
        }
        seen.add(property.name);
    }
}
function splitOnce(s, separator) {
    const index = s.indexOf(separator);
    if (index === -1) {
        return [s];
    }
    return [s.slice(0, index), s.slice(index + separator.length)];
}
export function parseProperty(s) {
    let [name, value] = splitOnce(s, ':').map(s => s.trim().replace(/;$/, '').toLowerCase());
    value = new RegExp(`^${value}$`);
    return { name, value };
}
export function serializeProperty(p) {
    return `${p.name}: ${p.value}`;
}

function simplify(regex) {
    return regex
        .replaceAll('[0-0]', '0')
        .replaceAll('[9-9]', '9')
        .replaceAll('[0-9]', '\\d')
        .replaceAll('\\d{0}', '')
        .replaceAll('\\d{1}', '\\d')
        .replaceAll('\\d{0,1}', '\\d')
        .replaceAll('\\d{1,}', '\\d+')
}

function gtRules(n) {
    let rules = [];
    n = n.toString();
    for (let i = 0; i < n.length; i++) {
        if (n[i] !== '9') {
            const prefix = n.slice(0, i);
            const charset = `[${parseInt(n[i]) + 1}-9]`;
            const suffix = `\\d{${n.length - i - 1}}`;
            rules.push(prefix + charset + suffix);
        }
    }

    rules.reverse();
    rules.push(`\\d{${n.length + 1},}`);
    return simplify(`(${rules.join('|')})`);
}
export function gtRE(n) {
    // Generate a Regular Expression that matches any number greater than n
    if (n < 0) {
        return `^(-${ltRules(-n)}|\\d+)$`;
    } else {
        return `^${gtRules(n)}$`;
    }
}

function ltRules(n) {
    let rules = [];
    n = n.toString();
    for (let i = 0; i < n.length; i++) {
        if (n[i] !== '0') {
            const prefix = n.slice(0, i);
            const charset = `[0-${parseInt(n[i]) - 1}]`;
            const suffix = `\\d{${n.length - i - 1}}`;
            rules.push(prefix + charset + suffix);
        }
    }

    rules.reverse();
    rules.push(`\\d{0,${n.length - 1}}`);
    return simplify(`(${rules.join('|')})`);
}
export function ltRE(n) {
    // Generate a Regular Expression that matches any number less than n
    if (n < 0) {
        return `^-${gtRules(-n)}$`;
    } else {
        return `^(-\\d+|${ltRules(n)})$`;
    }
}
