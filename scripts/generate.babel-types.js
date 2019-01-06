import path from 'path';
import {writeFileSync, existsSync, mkdirSync} from 'fs';
import {inspect} from 'util';
import * as types from '@babel/types';

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ROOT_DIR, 'src');
const FILENAME = path.relative(ROOT_DIR, __filename);
const DISCLAIMER = `AUTOMATICALLY GENERATED BY ${FILENAME}`;
const DEST_TYPE_DECLARATIONS_DIR = path.resolve(ROOT_DIR, 'flow-typed');
const DEST_BABEL_TYPES_DIR = path.resolve(SRC_DIR, 'lib');
const DEST_TYPE_DECLARATIONS = path.resolve(
  DEST_TYPE_DECLARATIONS_DIR,
  'babel-nodes.js',
);
const DEST_BABEL_TYPES = path.resolve(DEST_BABEL_TYPES_DIR, 'babel-types.js');

function isKeyword(n) {
  return (
    n === 'extends' || n === 'arguments' || n === 'static' || n === 'default'
  );
}

function getTypeFromValidator(validator) {
  if (validator.type) {
    return validator.type;
  } else if (validator.oneOfNodeTypes) {
    return validator.oneOfNodeTypes.join(' | ');
  } else if (validator.oneOfNodeOrValueTypes) {
    return validator.oneOfNodeOrValueTypes.join(' | ');
  } else if (validator.oneOf) {
    return validator.oneOf.map(val => inspect(val)).join(' | ');
  } else if (validator.chainOf) {
    if (
      validator.chainOf.length === 2 &&
      validator.chainOf[0].type === 'array' &&
      validator.chainOf[1].each
    ) {
      return (
        '$ReadOnlyArray<' +
        getTypeFromValidator(validator.chainOf[1].each) +
        '>'
      );
    }
    if (
      validator.chainOf.length === 2 &&
      validator.chainOf[0].type === 'string' &&
      validator.chainOf[1].oneOf
    ) {
      return validator.chainOf[1].oneOf
        .map(function(val) {
          return JSON.stringify(val);
        })
        .join(' | ');
    }
  }
  const err = new Error('Unrecognised validator type');
  err.code = 'UNEXPECTED_VALIDATOR_TYPE';
  err.validator = validator;
  throw err;
}

const customTypes = {
  ClassMethod: {
    key: 'Expression',
  },
  ClassProperty: {
    key: 'Expression',
  },
  Identifier: {
    name: 'string',
  },
  MemberExpression: {
    property: 'Expression',
  },
  OptionalMemberExpression: {
    property: 'Expression',
  },
  ObjectMethod: {
    key: 'Expression',
  },
  ObjectProperty: {
    key: 'Expression',
  },
  TSDeclareMethod: {
    key: 'Expression',
  },
};

function getType(key, field) {
  const validator = types.NODE_FIELDS[key][field].validate;
  if (customTypes[key] && customTypes[key][field]) {
    return customTypes[key][field];
  } else if (validator) {
    try {
      return getTypeFromValidator(types.NODE_FIELDS[key][field].validate);
    } catch (ex) {
      if (ex.code === 'UNEXPECTED_VALIDATOR_TYPE') {
        console.log('Unrecognised validator type for ' + key + '.' + field);
        console.dir(ex.validator, {depth: 10, colors: true});
      } else {
        throw ex;
      }
      return 'mixed';
    }
  } else {
    return 'mixed';
  }
}

const aliases = {};
const babelNodes = [`// ${DISCLAIMER}`, ``];
babelNodes.push(
  `type Location = {start: {line: number, column: number}, end: {line: number, column: number}};`,
);
babelNodes.push(``);
Object.keys(types.BUILDER_KEYS)
  .sort()
  .forEach(key => {
    babelNodes.push(`declare class ${key} {`);
    babelNodes.push(`  type: '${key}';`);
    babelNodes.push(`  loc: ?Location;`);
    Object.keys(types.NODE_FIELDS[key])
      .sort(function(fieldA, fieldB) {
        const indexA = types.BUILDER_KEYS[key].indexOf(fieldA);
        const indexB = types.BUILDER_KEYS[key].indexOf(fieldB);
        if (indexA === indexB) return fieldA < fieldB ? -1 : 1;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      })
      .forEach(function(field) {
        const t = getType(key, field);
        const optional = types.NODE_FIELDS[key][field].optional ? '?' : '';
        if (field === 'static') {
          return;
        }
        babelNodes.push(`  ${field}: ${optional}${t};`);
      });
    babelNodes.push(``);

    (types.ALIAS_KEYS[key] || []).concat(['BabelNode']).forEach(k => {
      babelNodes.push(`  // alias: ${k}`);
      if (!aliases[k]) aliases[k] = [];
      aliases[k].push(key);
    });

    babelNodes.push(`}`);
    babelNodes.push(``);
  });

Object.keys(aliases).forEach(key => {
  // Function is not a polymorphic type
  if (key === 'Function') {
    return false;
  }

  babelNodes.push(`type ${key} = (`);
  aliases[key].sort().forEach(k => {
    babelNodes.push(`  | ${k}`);
  });
  babelNodes.push(`);`);
  babelNodes.push(``);
});

babelNodes.push(
  `type JSXValue = JSXText | JSXExpressionContainer | JSXSpreadChild | JSXElement;`,
);

const babelTypes = [`// ${DISCLAIMER}`, '// @flow', ''];
babelTypes.push(`let t: any = null;`);
babelTypes.push(`let currentLocation: any = null;`);
babelTypes.push(
  `export function getCurrentLocation(): Location { return currentLocation; }`,
);
babelTypes.push(
  `export function setCurrentLocation(loc: Location): Location { return currentLocation = loc; }`,
);
babelTypes.push(
  `export function setBabelTypes(_t: Object): Location { return t = _t; }`,
);
babelTypes.push(``);
babelTypes.push(`const BabelTypes = {`);
Object.keys(types.BUILDER_KEYS)
  .sort()
  .forEach(key => {
    babelTypes.push(
      `  ${key[0].toLowerCase() + key.substr(1)}(${types.BUILDER_KEYS[key]
        .map(field => {
          const t = getType(key, field);
          const isOptional = !!types.NODE_FIELDS[key][field].optional;
          const hasDefault = types.NODE_FIELDS[key][field].default !== null;
          const optional = isOptional || hasDefault ? '?' : '';
          return `${isKeyword(field) ? '_' + field : field}: ${optional}${t}`;
        })
        .join(', ')}): ${key} {`,
    );
    babelTypes.push(`    const args = ([].slice: any).call(arguments);`);
    babelTypes.push(`    let loc = args[args.length - 1];`);
    babelTypes.push(
      `    const hasLoc = (loc && typeof loc === 'object' && typeof loc.start === 'object' && typeof loc.end === 'object');`,
    );
    babelTypes.push(`    if (hasLoc) {`);
    babelTypes.push(`      args.pop();`);
    babelTypes.push(`    }`);
    babelTypes.push(
      `    return {...t.${key}.apply(t, args), loc: hasLoc ? (loc: any) : getCurrentLocation()};`,
    );
    babelTypes.push(`  },`);
  });
Object.keys(types.BUILDER_KEYS)
  .sort()
  .forEach(key => {
    babelTypes.push(`  is${key}(value: any, opts?: Object): boolean {`);
    babelTypes.push(`    return t.is${key}.apply(t, arguments);`);
    babelTypes.push('  },');
  });
Object.keys(types.BUILDER_KEYS)
  .sort()
  .forEach(key => {
    babelTypes.push(`  assert${key}(value: ${key}, opts?: Object): mixed {`);
    babelTypes.push(`    return t.assert${key}.apply(t, arguments);`);
    babelTypes.push('  },');
  });
Object.keys(types.BUILDER_KEYS)
  .sort()
  .forEach(key => {
    babelTypes.push(`  as${key}(value: any, opts?: Object): ${key} | void {`);
    babelTypes.push(
      `    return t.is${key}.apply(t, arguments) ? (value: any) : undefined;`,
    );
    babelTypes.push('  },');
  });
babelTypes.push(`}`);
babelTypes.push(``);
babelTypes.push(`export default BabelTypes;`);
babelTypes.push(``);

if (!existsSync(DEST_TYPE_DECLARATIONS_DIR)) {
  mkdirSync(DEST_TYPE_DECLARATIONS_DIR);
}

writeFileSync(DEST_TYPE_DECLARATIONS, babelNodes.join('\n'));
console.log(
  `${FILENAME} -> ${path.relative(ROOT_DIR, DEST_TYPE_DECLARATIONS)}`,
);

if (!existsSync(DEST_BABEL_TYPES_DIR)) {
  mkdirSync(DEST_BABEL_TYPES_DIR);
}

writeFileSync(DEST_BABEL_TYPES, babelTypes.join('\n'));
console.log(`${FILENAME} -> ${path.relative(ROOT_DIR, DEST_BABEL_TYPES)}`);
