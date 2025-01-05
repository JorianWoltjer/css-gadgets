const parsel = require("./parsel.js");
const satisfy = require("./satisfy.js");
const CSSOM = require('cssom');
const fs = require('fs');
const util = require('util');

// Values here are regexes (full match)
const TARGET_PROPERTIES = ['position: fixed', 'width: 100(%|vw)', 'height: 100(%|vw)', 'top: 0', 'display: block', 'left: 0', 'margin: 0', 'background: .*'].map(parseProperty);
// Any rule containing these properties will be ignored. Note: you may be able to overwrite any of these manually.
const AVOID_PROPERTIES = ['opacity: ((0|0?\\.\\d+)|\\d{0,2}(\\.\\d+)?%)', 'display: none', 'z-index: -\d+'].map(parseProperty);
// const AVOID_PROPERTIES = [].map(parseProperty);
// TODO: allow filtering selectors by being able to use arbitrary tag names, IDs, nested elements or pseudo-classes
// TODO: check !important (priority)
// TODO: check duplicate keys in TARGET_PROPERTIES and AVOID_PROPERTIES
const LOG_FAILS = false;  // Log when combining selectors into HTML fails. You may be able to come up with a solution manually.

// copy((await Promise.all([...document.styleSheets].map(s => s.href ? fetch(s.href).then(r => r.text()) : s.ownerNode.innerText))).join('\n'))
const content = fs.readFileSync(process.argv[2], 'utf8');

function parse(content) {
    // https://github.com/NV/CSSOM/issues/51

    // https://github.com/NV/CSSOM/issues/116
    // TODO: just switch back
    const ast = CSSOM.parse(content);
    return ast;
}

const ast = parse(content);
// console.log(util.inspect(ast, false, null, true));
// exit();

function splitOnce(s, separator) {
    const index = s.indexOf(separator);
    if (index === -1) {
        return [s];
    }
    return [s.slice(0, index), s.slice(index + separator.length)];
}
function parseProperty(s) {
    let [name, value] = splitOnce(s, ':').map(s => s.trim().replace(/;$/, '').toLowerCase());
    value = new RegExp(`^${value}$`);
    return { name, value };
}
function serializeProperty(p) {
    return `${p.name}: ${p.value}`;
}

function findGadgets(ast) {
    const gadgets = Object.fromEntries(TARGET_PROPERTIES.map(target => [serializeProperty(target), { target, selectors: [] }]));

    // Try to find gadgets for all target properties
    for (const rule of ast.cssRules) {
        // TODO: search for gadgets in @media queries/@support rules too?
        if (rule.type !== CSSOM.CSSRule.STYLE_RULE) continue;

        const properties = Array.from(rule.style).map(name => ({ name, value: rule.style.getPropertyValue(name) }));;
        // Check if this rule has any properties to avoid
        if (properties.some(d => AVOID_PROPERTIES.some(p => d.name === p.name && d.value.match(p.value)))) continue;

        // Loop over all properties in this rule
        for (let i = 0; i < rule.style.length; i++) {
            const name = rule.style[i];
            const value = rule.style.getPropertyValue(name);

            const other_properties = properties.filter(p => p.name !== name);
            // Selector may contain multiple with ',' comma
            let selectors = parsel.parse(rule.selectorText);
            if (selectors.type !== 'list') {
                selectors = { type: 'list', list: [selectors] };
            }

            for (const target of TARGET_PROPERTIES) {
                // Check if it matches the target property
                if (target.name !== name || !value.match(target.value)) continue;

                console.log(`${name}: ${value} => ${parsel.stringify(selectors)}`);
                for (const selector of selectors.list) {
                    // Some selector syntax has higher priority than other (https://developer.mozilla.org/en-US/docs/Web/CSS/Specificity)
                    // The further down the file, the higher the priority
                    const priority = [...parsel.specificity(selector), rule.__starts];

                    gadgets[serializeProperty(target)].selectors.push({
                        selector: parsel.stringify(selector),
                        priority,
                        match: { name, value },
                        other_properties,
                    });
                }
            };
        }
    }

    function weightSelector(selector) {
        const overwritingTargetProperties = selector.other_properties.reduce(
            (total, p) => total + TARGET_PROPERTIES.some(t => p.name == t.name && !p.value.match(t.value)),
            0);

        const selectorComplexity = parsel.tokenize(selector.selector).reduce(
            (total, token) => total + ({
                "type": 5,
                "attribute": 1,
                "id": 1,
            }[token.type] || 0),
            0);

        // The higher this return value, the lower down in the search order it will go
        // - It is bad to have a complex selector, likely difficult to combine
        // - It is bad to overwrite other target properties (specificity may solve this so don't deny outright)
        // - It is slightly bad to have a lot of other properties, more chance of weird unwanted CSS
        return selectorComplexity * 20 + overwritingTargetProperties * 10 + selector.other_properties.length;
    }

    // Shortest selectors first, most likely to not have conflicts
    for (const [key, value] of Object.entries(gadgets)) {
        value.selectors.sort((a, b) => {
            return weightSelector(a) - weightSelector(b);
        });
    }

    return Object.values(gadgets);
}

function satisfyMany(selectors) {
    function toList(element) {
        const result = [];
        while (element) {
            result.push(element);
            element = element.childNodes[0];
        }
        result.reverse();
        return result;
    }
    function fromList(list) {
        list.reverse();
        for (let i = 0; i < list.length - 1; i++) {
            list[i].appendChild(list[i + 1]);
        }
        return list[0];
    }

    // Convert 1st selector to an nested HTML element, then list the nested children
    let result = toList(satisfy(selectors[0]));
    // Go through all other selectors and merge them with the `result` one by one
    for (let i = 1; i < selectors.length; i++) {
        let toBeAdded = toList(satisfy(selectors[i]));
        // If `toBeAdded` is larger, swap them
        if (result.length < toBeAdded.length) {
            const temp = result;
            result = toBeAdded;
            toBeAdded = temp;
        }
        // Start with innermost child, merge their attributes
        for (let j = 0; j < toBeAdded.length; j++) {
            const r = result[j];
            const a = toBeAdded[j];
            if (r.nodeName !== a.nodeName) {
                // TODO: if it is a <div>, should make it <any>. then we can chance it once to allow more combinations
                throw new Error(`Cannot merge ${r.nodeName} with ${a.nodeName}`);
            }
            for (const attribute of a.attributes) {
                if (attribute.name == "class") {
                    // Classes can be merged
                    if (r.hasAttribute("class") && r.getAttribute("class").split(" ").includes(attribute.value)) continue;
                    r.setAttribute("class", (r.getAttribute("class") || "") + " " + attribute.value);
                } else if (!r.hasAttribute(attribute.name) || r.getAttribute(attribute.name) === attribute.value) {
                    // Any other attribute may only be added if it doesn't exist or has the same value
                    r.setAttribute(attribute.name, attribute.value);
                } else {
                    throw new Error(`Cannot merge attribute ${attribute.name}`);
                }
            }
        }
    }
    // Return single fully merged HTML element
    return fromList(result).outerHTML;
}

function findCombinations(gadgets) {
    const selectedSelectors = []; // To store currently selected selectors

    function isOverwriting(selectorA, targetA, selectorB, targetB) {
        // Check priority to find who overwrites whom
        if (selectorA.priority > selectorB.priority) {
            return selectorA.other_properties.some(p =>
                p.name === targetB.name && !p.value.match(targetB.value)
            );
        } else {
            return selectorB.other_properties.some(p =>
                p.name === targetA.name && !p.value.match(targetA.value)
            );
        }
    }

    function backtrack(level) {
        if (level === gadgets.length) {
            // Base case: all targets have been processed
            let html;
            let error = false;
            try {
                html = satisfyMany(selectedSelectors.map(s => s.selector));
                // TODO: find avoid selectors and querySelector the HTML to check (side effects)
                // ^^ this will be hard because specificity may make it not matter
            } catch (e) {
                if (!LOG_FAILS) return;
                error = e;
            }
            console.log("Found a combination:");
            selectedSelectors.forEach((selector, index) => {
                console.log(selector);
            });
            if (error) {
                console.log("ERROR:");
                console.log(error.message);
            } else {
                console.log("HTML:");
                console.log(html);
            }
            return;
        }

        const currentTarget = gadgets[level];
        for (const currentSelector of currentTarget.selectors) {
            let valid = true;

            // Check the current selector against all previously selected selectors
            for (let i = 0; i < level; i++) {
                const previousSelector = selectedSelectors[i];
                const previousTarget = gadgets[i];

                if (isOverwriting(currentSelector, currentTarget.target, previousSelector, previousTarget.target)) {
                    valid = false;
                    break;
                }
            }

            if (valid) {
                // Add current selector to the selected list and proceed
                selectedSelectors.push(currentSelector);
                backtrack(level + 1);
                selectedSelectors.pop(); // Backtrack
            }
        }
    }

    backtrack(0); // Start at level 0
}

// Mapping of target properties to selectors and their other properties
const gadgets = findGadgets(ast);
console.log(util.inspect(gadgets, { depth: null, colors: true, maxArrayLength: null }));

console.log("=".repeat(80));
for (const gadget of gadgets) {
    const msg = `Found ${gadget.selectors.length} gadgets for ${serializeProperty(gadget.target)}`;
    if (gadget.selectors.length === 0) {
        throw new Error(msg);
    } else {
        console.log(msg);
    }
}
console.log("=".repeat(80));

// Find where the selector rules don't overwrite each other
findCombinations(gadgets);
