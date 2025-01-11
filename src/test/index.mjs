import { gtRE, ltRE } from '../util.js';

console.log(gtRE(8942));
console.log(ltRE(1042));

// Tests
for (let n = -100; n < 100; n++) {
    const ns = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 2000) - 1000);
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
