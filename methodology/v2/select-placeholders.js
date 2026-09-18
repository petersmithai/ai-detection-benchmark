/**
 * PLACEHOLDER SELECTION v1 — the canonical copy, frozen into each cycle at open.
 *
 * The point of this file is that nobody, including the maintainer, can choose
 * which prompts a cycle uses. SHA-256(nonce) is published in commit.json before
 * a single prompt is generated; the nonce itself is published at cycle close.
 * Anyone can then replay this function and confirm the prompts in prompts.json
 * are the only prompts that nonce could have produced.
 *
 * Deterministic: same nonce + same banks + same templates => same prompts.
 * No I/O, no clock, no randomness.
 */

import { createHmac } from 'node:crypto';

export const SELECTION_VERSION = '1.0.0';

/**
 * Draw an index in [0, size) from the nonce and a label, without modulo bias.
 * Rejection sampling over 32-bit windows of an HMAC stream; the counter only
 * advances on rejection, so the common path is one HMAC.
 */
function drawIndex(nonce, label, size) {
  if (size <= 0) throw new Error(`empty bank for ${label}`);
  const limit = Math.floor(0x100000000 / size) * size;
  for (let counter = 0; counter < 1000; counter++) {
    const digest = createHmac('sha256', nonce).update(`${label}#${counter}`).digest();
    for (let offset = 0; offset + 4 <= digest.length; offset += 4) {
      const value = digest.readUInt32BE(offset);
      if (value < limit) return value % size;
    }
  }
  throw new Error(`rejection sampling failed for ${label}`);
}

/**
 * @param {object} input
 * @param {string} input.cycleId
 * @param {string} input.nonce            Hex nonce revealed at cycle close.
 * @param {Array}  input.templates        datasets/ai/templates.json .templates
 * @param {object} input.banks            datasets/ai/banks.json .banks
 * @param {number} input.variantsPerTemplate
 * @param {Array<string>} input.generators Generator slugs, assigned round-robin.
 * @returns {Array} prompts
 */
export function selectPrompts({ cycleId, nonce, templates, banks, variantsPerTemplate, generators }) {
  const prompts = [];

  for (const template of templates) {
    // Values already spent by earlier variants of this template, so the four
    // variants of one template never resolve to the same prompt.
    const used = new Map(template.slots.map((slot) => [slot, new Set()]));

    for (let variant = 0; variant < variantsPerTemplate; variant++) {
      const values = {};
      for (const slot of template.slots) {
        const bank = banks[slot];
        if (!Array.isArray(bank)) throw new Error(`missing bank: ${slot}`);
        const spent = used.get(slot);
        const exhausted = spent.size >= bank.length;

        let index = drawIndex(nonce, `${cycleId}|${template.id}|${variant}|${slot}`, bank.length);
        // Linear probe forward past values this template already used. Probing
        // is deterministic, so the replay lands on the same value.
        let probes = 0;
        while (!exhausted && spent.has(index) && probes < bank.length) {
          index = (index + 1) % bank.length;
          probes++;
        }
        spent.add(index);
        values[slot] = bank[index];
      }

      const text = template.slots.reduce(
        (acc, slot) => acc.split(`{{${slot}}}`).join(values[slot]),
        template.text,
      );
      if (text.includes('{{')) throw new Error(`unresolved placeholder in ${template.id} variant ${variant}`);

      prompts.push({
        id: `ai-${template.domain}-${variant + 1}`,
        templateId: template.id,
        domain: template.domain,
        variant,
        generator: generators[(prompts.length + variant) % generators.length],
        values,
        prompt: text,
      });
    }
  }

  return prompts;
}
