// The shipped D&D 5e preset (SPEC §10). Fully editable after creation.
// v1: saves/skills are raw ability mods (no proficiency toggle yet).

const ABILITIES = [
  ['strength', 'Strength', 'str'],
  ['dexterity', 'Dexterity', 'dex'],
  ['constitution', 'Constitution', 'con'],
  ['intelligence', 'Intelligence', 'int'],
  ['wisdom', 'Wisdom', 'wis'],
  ['charisma', 'Charisma', 'cha'],
];

const SKILLS = [
  ['athletics', 'Athletics', 'str'],
  ['acrobatics', 'Acrobatics', 'dex'],
  ['stealth', 'Stealth', 'dex'],
  ['perception', 'Perception', 'wis'],
  ['investigation', 'Investigation', 'int'],
  ['persuasion', 'Persuasion', 'cha'],
];

let n = 0;
const uid = (p) => `${p}_${(Date.now().toString(36))}${(n++).toString(36)}`;

export function newId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function dnd5eCharacter(name = 'New Hero') {
  const values = [];

  values.push({ id: 'char_class', label: 'Class', kind: 'text', text: 'Fighter', group: 'Bio' });
  values.push({ id: 'level', label: 'Level', kind: 'number', value: 1, group: 'Bio' });
  values.push({ id: 'proficiency_bonus', label: 'Prof', kind: 'calc', formula: '2 + floor((level - 1) / 4)', group: 'Bio' });

  for (const [id, label] of ABILITIES) {
    values.push({ id, label, kind: 'number', value: 10, group: 'Abilities' });
  }
  for (const [id, label, ab] of ABILITIES.map((a) => [`${a[2]}_mod`, `${a[2].toUpperCase()} Mod`, a[0]])) {
    values.push({ id, label, kind: 'calc', formula: `floor((${ab} - 10) / 2)`, group: 'Abilities' });
  }

  values.push({ id: 'armor_class', label: 'AC', kind: 'calc', formula: '10 + dex_mod', group: 'Combat' });
  values.push({ id: 'initiative', label: 'Initiative', kind: 'calc', formula: 'dex_mod', group: 'Combat' });
  values.push({ id: 'hp_current', label: 'HP', kind: 'number', value: 10, group: 'Combat' });
  values.push({ id: 'hp_max', label: 'Max HP', kind: 'number', value: 10, group: 'Combat' });

  // Saving throws — raw ability mods in v1 (proficiency deferred to v1.1).
  for (const [, , ab] of ABILITIES) {
    values.push({ id: `save_${ab}`, label: `${ab.toUpperCase()} Save`, kind: 'calc', formula: `${ab}_mod`, group: 'Saves' });
  }

  // Skills — raw ability mods.
  for (const [id, label, ab] of SKILLS) {
    values.push({ id, label, kind: 'calc', formula: `${ab}_mod`, group: 'Skills' });
  }

  // Example weapons demonstrating the roll model.
  values.push({ id: 'longsword', label: 'Longsword', kind: 'text', text: 'Longsword', roll: '1d8 + str_mod', description: 'Versatile (1d10). Melee, 5 ft.', group: 'Attacks' });
  values.push({ id: 'shortbow', label: 'Shortbow', kind: 'text', text: 'Shortbow', roll: '1d6 + dex_mod', description: 'Ranged, 80/320 ft.', group: 'Attacks' });

  const w = (o) => ({ kind: 'bound', cols: 1, rows: 1, tap: 'none', ...o, id: newId('w') });

  const pages = [
    {
      id: newId('page'), name: 'Core',
      widgets: [
        w({ ref: 'char_class', secondaryRef: 'level', cols: 2, tap: 'none' }),
        w({ ref: 'strength', secondaryRef: 'str_mod', tap: 'roll', rollOverride: '1d20 + str_mod' }),
        w({ ref: 'dexterity', secondaryRef: 'dex_mod', tap: 'roll', rollOverride: '1d20 + dex_mod' }),
        w({ ref: 'constitution', secondaryRef: 'con_mod', tap: 'roll', rollOverride: '1d20 + con_mod' }),
        w({ ref: 'intelligence', secondaryRef: 'int_mod', tap: 'roll', rollOverride: '1d20 + int_mod' }),
        w({ ref: 'wisdom', secondaryRef: 'wis_mod', tap: 'roll', rollOverride: '1d20 + wis_mod' }),
        w({ ref: 'charisma', secondaryRef: 'cha_mod', tap: 'roll', rollOverride: '1d20 + cha_mod' }),
        w({ ref: 'proficiency_bonus', tap: 'detail' }),
        w({ ref: 'armor_class', tap: 'detail' }),
        w({ ref: 'hp_current', secondaryRef: 'hp_max', cols: 2, tap: 'none' }),
      ],
    },
    {
      id: newId('page'), name: 'Combat',
      widgets: [
        w({ ref: 'armor_class', tap: 'detail' }),
        w({ ref: 'initiative', tap: 'roll', rollOverride: '1d20 + initiative' }),
        w({ ref: 'hp_current', secondaryRef: 'hp_max', cols: 2, tap: 'none' }),
        w({ kind: 'label', title: 'Saving Throws', cols: 2 }),
        w({ ref: 'save_str', tap: 'roll', rollOverride: '1d20 + save_str' }),
        w({ ref: 'save_dex', tap: 'roll', rollOverride: '1d20 + save_dex' }),
        w({ ref: 'save_con', tap: 'roll', rollOverride: '1d20 + save_con' }),
        w({ ref: 'save_wis', tap: 'roll', rollOverride: '1d20 + save_wis' }),
        w({ kind: 'label', title: 'Attacks', cols: 2 }),
        w({ ref: 'longsword', cols: 2, tap: 'roll' }),
        w({ ref: 'shortbow', cols: 2, tap: 'roll' }),
      ],
    },
    {
      id: newId('page'), name: 'Skills',
      widgets: [
        w({ kind: 'label', title: 'Skills (roll a check)', cols: 2 }),
        ...SKILLS.map(([id]) => w({ ref: id, tap: 'roll', rollOverride: `1d20 + ${id}` })),
      ],
    },
  ];

  return {
    id: newId('char'),
    name,
    preset: 'dnd5e',
    createdAt: new Date().toISOString(),
    values,
    pages,
  };
}

export function blankCharacter(name = 'New Character') {
  return {
    id: newId('char'),
    name,
    preset: 'blank',
    createdAt: new Date().toISOString(),
    values: [{ id: 'notes', label: 'Notes', kind: 'text', text: '', group: 'General' }],
    pages: [{ id: newId('page'), name: 'Page 1', widgets: [{ id: newId('w'), kind: 'bound', ref: 'notes', cols: 2, rows: 3, tap: 'none' }] }],
  };
}
