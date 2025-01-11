import * as parsel from './parsel.js';
import satisfy from './satisfy.js';
import { serializeProperty } from './util.js';
import fs from 'fs';

export class GadgetFinder {
    constructor(target_properties, avoid_properties, avoid_selectors) {
        this.target_properties = target_properties;
        this.avoid_properties = avoid_properties;
        this.avoid_selectors = avoid_selectors;
    }

    isAllowedSelector(selector) {
        const tokens = parsel.tokenize(selector);
        for (const token of tokens) {
            const avoid = this.avoid_selectors[token.type];
            if (avoid === true) {
                return false;
            } else if (avoid instanceof Array) {
                if (avoid.includes(token.name)) {
                    return false;
                }
            }
        }
        return true;
    }

    weightSelector(selector) {
        const overwritingTargetProperties = selector.other_properties.reduce(
            (total, p) => total + this.target_properties.some(t => p.name == t.name && !p.value.match(t.value)),
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

    findGadgets(ast) {
        const gadgets = Object.fromEntries(this.target_properties.map(target => [serializeProperty(target), { target, selectors: [] }]));

        // Try to find gadgets for all target properties
        for (const rule of ast.stylesheet.rules) {
            if (rule.type !== 'rule') continue;

            // Check if this rule has any properties to avoid
            const properties = rule.declarations.filter(d => d.type === 'declaration').map(d => ({ name: d.property, value: d.value }));
            if (properties.some(d => this.avoid_properties.some(p => d.name === p.name && d.value.match(p.value)))) continue;

            // Loop over all properties in this rule
            for (const property of properties) {
                // Remove !important, it is not part of the value
                property.value = property.value.replace(/\s*!important$/, '');

                const other_properties = properties.filter(d => d !== property);

                for (const target of this.target_properties) {
                    // Check if it matches the target property
                    if (target.name !== property.name || !property.value.match(target.value)) continue;

                    console.log(`${property.name}: ${property.value} => ${rule.selectors.join(', ')}`);
                    // Split rule into its selectors
                    for (const selector of rule.selectors) {
                        if (!this.isAllowedSelector(selector)) continue;

                        // Some selector syntax has higher priority than other (https://developer.mozilla.org/en-US/docs/Web/CSS/Specificity)
                        // The further down the file, the higher the priority
                        const { line, column } = rule.position.start;
                        let specificity;
                        try {
                            specificity = parsel.specificity(selector);
                        } catch (e) {
                            console.error(e.message);
                            continue;
                        }
                        const priority = [...specificity, line, column];

                        gadgets[serializeProperty(target)].selectors.push({
                            selector,
                            priority,
                            match: property,
                            other_properties,
                        });
                    }
                };
            }
        }

        // Shortest selectors first, most likely to not have conflicts
        for (const gadget of Object.values(gadgets)) {
            gadget.selectors.sort((a, b) => {
                return this.weightSelector(a) - this.weightSelector(b);
            });
        }

        return Object.values(gadgets);
    }
}

export class Combinator {
    constructor(log_failed_combinations) {
        this.log_failed_combinations = log_failed_combinations;
    }

    static satisfyMany(selectors) {
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
            list.at(-1).innerHTML = "Content";
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
                // If node names are different, try to merge them
                if (r.nodeName !== a.nodeName && a.nodeName !== "any") {
                    if (r.nodeName === "any") {
                        r.nodeName = a.nodeName;
                    } else {
                        throw new Error(`Cannot merge node name <${r.nodeName}> with <${a.nodeName}>`);
                    }
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
                        throw new Error(`Cannot merge attribute ${attribute.name}=`);
                    }
                }
            }
        }
        // Return single fully merged HTML element
        return fromList(result).outerHTML;
    }

    static isOverwriting(selectorA, targetA, selectorB, targetB) {
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

    findCombinations(gadgets, htmlFilename) {
        const selectedSelectors = []; // To store currently selected selectors

        function backtrack(level, log_failed_combinations) {
            if (level === gadgets.length) {
                // Base case: all targets have been processed
                let html;
                let error = false;
                try {
                    html = Combinator.satisfyMany(selectedSelectors.map(s => s.selector));
                } catch (e) {
                    console.warn(e.message);
                    if (!log_failed_combinations) return;
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
                    console.log("```html");
                    console.log(html);
                    console.log("```");
                    if (htmlFilename) fs.appendFileSync(htmlFilename, html + '\n');
                }
                console.log();
                return;
            }

            const currentTarget = gadgets[level];
            for (const currentSelector of currentTarget.selectors) {
                let valid = true;

                // Check the current selector against all previously selected selectors
                for (let i = 0; i < level; i++) {
                    const previousSelector = selectedSelectors[i];
                    const previousTarget = gadgets[i];

                    if (Combinator.isOverwriting(currentSelector, currentTarget.target, previousSelector, previousTarget.target)) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    // Add current selector to the selected list and proceed
                    selectedSelectors.push(currentSelector);
                    backtrack(level + 1, log_failed_combinations);
                    selectedSelectors.pop(); // Backtrack
                }
            }
        }

        backtrack(0, this.log_failed_combinations); // Start at level 0
    }
}
