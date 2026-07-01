// The shipped D&D 5e preset (SPEC §10). Fully editable after creation.
// Mirrors the layout of the official 5e sheet: abilities + modifiers, all six
// saves, the full 18-skill list, AC/initiative/speed, HP, attacks, and bio.
// v2: saves/skills are raw ability mods (proficiency toggle still deferred —
// it needs a boolean value kind).

const ABILITIES = [
  ['strength', 'Strength', 'str'],
  ['dexterity', 'Dexterity', 'dex'],
  ['constitution', 'Constitution', 'con'],
  ['intelligence', 'Intelligence', 'int'],
  ['wisdom', 'Wisdom', 'wis'],
  ['charisma', 'Charisma', 'cha'],
];

// Full 5e skill list with governing ability (official sheet order per ability).
const SKILLS = [
  ['acrobatics', 'Acrobatics', 'dex'],
  ['animal_handling', 'Animal Handling', 'wis'],
  ['arcana', 'Arcana', 'int'],
  ['athletics', 'Athletics', 'str'],
  ['deception', 'Deception', 'cha'],
  ['history', 'History', 'int'],
  ['insight', 'Insight', 'wis'],
  ['intimidation', 'Intimidation', 'cha'],
  ['investigation', 'Investigation', 'int'],
  ['medicine', 'Medicine', 'wis'],
  ['nature', 'Nature', 'int'],
  ['perception', 'Perception', 'wis'],
  ['performance', 'Performance', 'cha'],
  ['persuasion', 'Persuasion', 'cha'],
  ['religion', 'Religion', 'int'],
  ['sleight_of_hand', 'Sleight of Hand', 'dex'],
  ['stealth', 'Stealth', 'dex'],
  ['survival', 'Survival', 'wis'],
];

let n = 0;
const uid = (p) => `${p}_${(Date.now().toString(36))}${(n++).toString(36)}`;

export function newId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function dnd5eCharacter(name = 'New Hero') {
  const values = [];

  // Bio
  values.push({ id: 'char_class', label: 'Class', kind: 'text', text: 'Fighter', group: 'Bio' });
  values.push({ id: 'level', label: 'Level', kind: 'number', value: 1, group: 'Bio' });
  values.push({ id: 'race', label: 'Race', kind: 'text', text: '', group: 'Bio' });
  values.push({ id: 'background', label: 'Background', kind: 'text', text: '', group: 'Bio' });
  values.push({ id: 'alignment', label: 'Alignment', kind: 'text', text: '', group: 'Bio' });
  values.push({ id: 'proficiency_bonus', label: 'Prof', kind: 'calc', formula: '2 + floor((level - 1) / 4)', signed: true, group: 'Bio' });

  // Abilities + modifiers
  for (const [id, label] of ABILITIES) {
    values.push({ id, label, kind: 'number', value: 10, group: 'Abilities' });
  }
  for (const [id, label, ab] of ABILITIES.map((a) => [`${a[2]}_mod`, `${a[2].toUpperCase()} Mod`, a[0]])) {
    values.push({ id, label, kind: 'calc', formula: `floor((${ab} - 10) / 2)`, signed: true, group: 'Abilities' });
  }

  // Combat
  values.push({ id: 'armor_class', label: 'AC', kind: 'calc', formula: '10 + dex_mod', group: 'Combat' });
  values.push({ id: 'initiative', label: 'Initiative', kind: 'calc', formula: 'dex_mod', signed: true, group: 'Combat' });
  values.push({ id: 'speed', label: 'Speed', kind: 'number', value: 30, group: 'Combat' });
  values.push({ id: 'hp_current', label: 'HP', kind: 'number', value: 10, group: 'Combat' });
  values.push({ id: 'hp_max', label: 'Max HP', kind: 'number', value: 10, group: 'Combat' });

  // Saving throws — ability mod plus (proficient ? proficiency_bonus : 0).
  // Each save carries a boolean "proficient" leaf the sheet toggles with a dot.
  for (const [, , ab] of ABILITIES) {
    values.push({ id: `save_${ab}_prof`, label: `${ab.toUpperCase()} Save Proficient`, kind: 'bool', value: false, group: 'Saves' });
    values.push({ id: `save_${ab}`, label: `${ab.toUpperCase()} Save`, kind: 'calc', formula: `${ab}_mod + save_${ab}_prof * proficiency_bonus`, signed: true, group: 'Saves' });
  }

  // Skills — ability mod plus proficiency when the skill's dot is filled.
  for (const [id, label, ab] of SKILLS) {
    values.push({ id: `${id}_prof`, label: `${label} Proficient`, kind: 'bool', value: false, group: 'Skills' });
    values.push({ id, label, kind: 'calc', formula: `${ab}_mod + ${id}_prof * proficiency_bonus`, signed: true, group: 'Skills' });
  }
  values.push({ id: 'passive_perception', label: 'Passive Perception', kind: 'calc', formula: '10 + perception', group: 'Skills' });

  // Example weapons demonstrating the multi-roll model.
  values.push({ id: 'longsword', label: 'Longsword', kind: 'text', text: 'Longsword', description: 'Versatile (1d10). Melee, 5 ft.', group: 'Attacks',
    rolls: [{ name: 'Attack', expr: '1d20 + str_mod + proficiency_bonus' }, { name: 'Damage', expr: '1d8 + str_mod' }] });
  values.push({ id: 'shortbow', label: 'Shortbow', kind: 'text', text: 'Shortbow', description: 'Ranged, 80/320 ft.', group: 'Attacks',
    rolls: [{ name: 'Attack', expr: '1d20 + dex_mod + proficiency_bonus' }, { name: 'Damage', expr: '1d6 + dex_mod' }] });

  // Bio / freeform
  values.push({ id: 'features', label: 'Features & Traits', kind: 'text', text: '', group: 'Bio' });
  values.push({ id: 'equipment', label: 'Equipment', kind: 'text', text: '', group: 'Bio' });
  values.push({ id: 'notes', label: 'Notes', kind: 'text', text: '', group: 'Bio' });

  // Widget helper. cols/rows are authored in the intuitive 2-col scale and
  // scaled ×2 onto the 4-column fine grid. editableInPlay off by default.
  const w = (o) => {
    const { cols = 1, rows = 1, tap, editableInPlay = false, ...rest } = o;
    return { kind: 'bound', editableInPlay, ...rest, cols: cols * 2, rows: rows * 2, id: newId('w') };
  };

  const pages = [
    {
      id: newId('page'), name: 'Core',
      widgets: [
        w({ ref: 'char_class', secondaryRef: 'level', cols: 2 }),
        w({ ref: 'strength', secondaryRef: 'str_mod', face: 'stat', rollOverride: '1d20 + str_mod' }),
        w({ ref: 'dexterity', secondaryRef: 'dex_mod', face: 'stat', rollOverride: '1d20 + dex_mod' }),
        w({ ref: 'constitution', secondaryRef: 'con_mod', face: 'stat', rollOverride: '1d20 + con_mod' }),
        w({ ref: 'intelligence', secondaryRef: 'int_mod', face: 'stat', rollOverride: '1d20 + int_mod' }),
        w({ ref: 'wisdom', secondaryRef: 'wis_mod', face: 'stat', rollOverride: '1d20 + wis_mod' }),
        w({ ref: 'charisma', secondaryRef: 'cha_mod', face: 'stat', rollOverride: '1d20 + cha_mod' }),
        w({ ref: 'proficiency_bonus' }),
        w({ ref: 'passive_perception' }),
      ],
    },
    {
      id: newId('page'), name: 'Combat',
      widgets: [
        w({ ref: 'armor_class' }),
        w({ ref: 'initiative', rollOverride: '1d20 + initiative' }),
        w({ ref: 'speed' }),
        w({ ref: 'proficiency_bonus' }),
        w({ ref: 'hp_current', secondaryRef: 'hp_max', cols: 2, editableInPlay: true }),
        w({ kind: 'label', title: 'Saving Throws', cols: 2 }),
        w({ ref: 'save_str', profRef: 'save_str_prof', rollOverride: '1d20 + save_str' }),
        w({ ref: 'save_dex', profRef: 'save_dex_prof', rollOverride: '1d20 + save_dex' }),
        w({ ref: 'save_con', profRef: 'save_con_prof', rollOverride: '1d20 + save_con' }),
        w({ ref: 'save_int', profRef: 'save_int_prof', rollOverride: '1d20 + save_int' }),
        w({ ref: 'save_wis', profRef: 'save_wis_prof', rollOverride: '1d20 + save_wis' }),
        w({ ref: 'save_cha', profRef: 'save_cha_prof', rollOverride: '1d20 + save_cha' }),
        w({ kind: 'label', title: 'Attacks', cols: 2 }),
        w({ ref: 'longsword', cols: 2 }),
        w({ ref: 'shortbow', cols: 2 }),
      ],
    },
    {
      id: newId('page'), name: 'Skills',
      widgets: [
        w({ kind: 'label', title: 'Skills — ● = proficient · tap to roll', cols: 2 }),
        ...SKILLS.map(([id]) => w({ ref: id, profRef: `${id}_prof`, rollOverride: `1d20 + ${id}` })),
        w({ ref: 'passive_perception', cols: 2 }),
      ],
    },
    {
      id: newId('page'), name: 'Bio',
      widgets: [
        w({ ref: 'race' }),
        w({ ref: 'background' }),
        w({ ref: 'alignment', cols: 2 }),
        w({ kind: 'label', title: 'Features & Traits', cols: 2 }),
        w({ ref: 'features', cols: 2, rows: 3, editableInPlay: true }),
        w({ kind: 'label', title: 'Equipment', cols: 2 }),
        w({ ref: 'equipment', cols: 2, rows: 3, editableInPlay: true }),
        w({ kind: 'label', title: 'Notes', cols: 2 }),
        w({ ref: 'notes', cols: 2, rows: 3, editableInPlay: true }),
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
    pages: [{ id: newId('page'), name: 'Page 1', widgets: [{ id: newId('w'), kind: 'bound', ref: 'notes', cols: 4, rows: 6, editableInPlay: true }] }],
  };
}
