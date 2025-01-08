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
function gtRE(n) {
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
function ltRE(n) {
    // Generate a Regular Expression that matches any number less than n
    if (n < 0) {
        return `^-${gtRules(-n)}$`;
    } else {
        return `^(-\\d+|${ltRules(n)})$`;
    }
}

if (require.main === module) {
    console.log(gtRE(8942));
    console.log(ltRE(1042));

    // Tests
    for (let n = -100; n < 100; n++) {
        ns = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 2000) - 1000);
        ns.forEach(n => {
            const gt_re = new RegExp(gtRE(n));
            const lt_re = new RegExp(ltRE(n));
            ns.forEach(m => {
                if (m > n !== Boolean(gt_re.test(m))) {
                    console.error(`gt(${n}) failed for ${m}: ${gt_re}`);
                }
                if (m < n !== Boolean(lt_re.test(m))) {
                    console.error(`lt(${n}) failed for ${m}: ${lt_re}`);
                }
            });
        });
    }
}

module.exports = { gtRE, ltRE };
