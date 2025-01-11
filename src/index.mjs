import css from 'css';
import fs from 'fs';
import { outputFilename, ensureNoDuplicates, parseProperty, serializeProperty, gtRE, ltRE } from './util.js';
import { GadgetFinder, Combinator } from './search.js';

// Values here are regexes (full match)
const TARGET_PROPERTIES = ['position: fixed', 'width: 100(%|vw)', 'height: 100(%|vw)', 'top: 0', 'display: block', 'left: 0', 'margin: 0', 'background: .*', `z-index: ${gtRE(0)}`].map(parseProperty);
// Any rule containing these properties will be ignored. Note: you may be able to overwrite any of these manually
const AVOID_PROPERTIES = ['opacity: ((0|0?\\.\\d+)|\\d{0,2}(\\.\\d+)?%)', 'display: none'].map(parseProperty);
// Write any selectors that you cannot use here, `true` for any value of that sort. Useful to avoid side effects or disallowed HTML
const AVOID_SELECTORS = {
    type: true,
    class: [],
    id: true,
    attribute: true,
    combinator: false,
};
// Log when combining selectors into HTML fails. You may be able to come up with a solution manually.
const LOG_FAILED_COMBINATIONS = false;
// Write gadgets and stream HTML to files near input file
const WRITE_FILES = true;

if (process.argv.length !== 3) {
    console.error("Usage: node index.js <style.css>");
    process.exit(1);
}

const input = process.argv[2];
const content = fs.readFileSync(input, 'utf8');
const ast = css.parse(content);
// console.log(require("util").inspect(ast, false, null, true));
// exit();

ensureNoDuplicates(TARGET_PROPERTIES);
ensureNoDuplicates(AVOID_PROPERTIES);

const gadgetFinder = new GadgetFinder(TARGET_PROPERTIES, AVOID_PROPERTIES, AVOID_SELECTORS);
// Mapping of target properties to selectors and their other properties
const gadgets = gadgetFinder.findGadgets(ast);

if (WRITE_FILES) {
    const gadgetsFilename = outputFilename(input, 'gadgets.json');
    fs.writeFileSync(gadgetsFilename, JSON.stringify(gadgets, null, 2));
    console.log(`Wrote gadgets to ${gadgetsFilename}`);
}

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

let htmlFilename;
if (WRITE_FILES) {
    htmlFilename = outputFilename(input, 'output.html');
    fs.writeFileSync(htmlFilename, '');
    console.log(`Writing HTML to ${htmlFilename}`);
}

// Find where the selector rules don't overwrite each other
const combinator = new Combinator(LOG_FAILED_COMBINATIONS);
combinator.findCombinations(gadgets, htmlFilename);

console.log("Done!");
