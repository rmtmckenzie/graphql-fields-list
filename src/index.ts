/*!
 * ISC License
 *
 * Copyright (c) 2018-present, Mykhailo Stadnyk <mikhus@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
import {
    GraphQLResolveInfo,
} from 'graphql/type';
import {
    ArgumentNode,
    DirectiveNode,
    SelectionNode,
    FragmentDefinitionNode,
    FieldNode,
} from 'graphql/language';
import { FieldsListOptions, FragmentItem, MapResult, MapResultKey, VariablesValues } from '..';

/**
 * Pre-compiled wildcard replacement regexp
 *
 * @type {RegExp}
 */
const RX_AST = /\*/g;

/**
 * Traverse query nodes tree options arg interface
 * @access private
 */
interface TraverseOptions {
    fragments: FragmentItem;
    vars: any;
    withVars?: boolean;
}

/**
 * Retrieves a list of nodes from a given selection (either fragment or
 * selection node)
 *
 * @param {FragmentDefinitionNode | FieldNode} selection
 * @return {ReadonlyArray<FieldNode>}
 * @access private
 */
export function getNodes(
    selection: FragmentDefinitionNode | SelectionNode,
): ReadonlyArray<SelectionNode> {
	return (selection as any)?.selectionSet?.selections || [] as ReadonlyArray<SelectionNode>;
}

/**
 * Checks if a given directive name and value valid to return a field
 *
 * @param {string} name
 * @param {boolean} value
 * @return boolean
 * @access private
 */
export function checkValue(name: string, value: boolean): boolean {
    return name === 'skip'
        ? !value
        : name === 'include' ? value : true
    ;
}

/**
 * Checks if a given directive arg allows to return field
 *
 * @param {string} name - directive name
 * @param {ArgumentNode} arg
 * @param {VariablesValues} vars
 * @return {boolean}
 * @access private
 */
export function verifyDirectiveArg(
    name: string,
    arg: ArgumentNode,
    vars: VariablesValues
): boolean {
    switch (arg.value.kind) {
        case 'BooleanValue':
            return checkValue(name, arg.value.value);
        case 'Variable':
            return checkValue(name, vars[arg.value.name.value]);
    }

    return true;
}

/**
 * Checks if a given directive allows to return field
 *
 * @param {DirectiveNode} directive
 * @param {VariablesValues} vars
 * @return {boolean}
 * @access private
 */
export function verifyDirective(
    directive: DirectiveNode,
    vars: VariablesValues,
): boolean {
    const directiveName: string = directive.name.value;

    if (!~['include', 'skip'].indexOf(directiveName)) {
        return true;
    }

    let args: any[] = directive.arguments as any[];

    if (!(args && args.length)) {
        args = [];
    }

    for (const arg of args) {
        if (!verifyDirectiveArg(directiveName, arg, vars)) {
            return false;
        }
    }

    return true;
}

/**
 * Checks if a given list of directives allows to return field
 *
 * @param {ReadonlyArray<DirectiveNode>} directives
 * @param {VariablesValues} vars
 * @return {boolean}
 * @access private
 */
export function verifyDirectives(
    directives: ReadonlyArray<DirectiveNode> | undefined,
    vars: VariablesValues,
): boolean {
    if (!directives || !directives.length) {
        return true;
    }

    vars = vars || {};

    for (const directive of directives) {
        if (!verifyDirective(directive, vars)) {
            return false;
        }
    }

    return true;
}

type SkipValue = boolean | SkipTree;
type SkipTree = { [key: string]: SkipValue };

/**
 * Checks if a given node is inline fragment and process it,
 * otherwise does nothing and returns false.
 *
 * @param {SelectionNode} node
 * @param {MapResult | MapResultKey} root
 * @param {*} skip
 * @param {TraverseOptions} opts
 */
export function verifyInlineFragment(
    node: SelectionNode,
    root: MapResult | MapResultKey,
    opts: TraverseOptions,
    skip: SkipValue,
): boolean {
    if (node.kind === 'InlineFragment') {
        const nodes = getNodes(node);

        nodes.length && traverse(nodes, root, opts, skip);

        return true;
    }

    return false;
}

/**
 * Builds skip rules tree from a given skip option argument
 *
 * @param {string[]} skip - skip option arguments
 * @return {SkipTree} - skip rules tree
 */
export function skipTree(skip: string[]): SkipTree {
    const tree: SkipTree = {};

    for (const pattern of skip) {
        const props = pattern.split('.');
        let propTree: SkipTree = tree;

        for (let i = 0, s = props.length; i < s; i++) {
            const prop = props[i];
            const all = props[i + 1] === '*';

            if (!propTree[prop]) {
                propTree[prop] = i === s - 1 || all ? true : {};
                all && i++;
            }

            propTree = propTree[prop] as SkipTree;
        }
    }

    return tree;
}

/**
 *
 * @param node
 * @param skip
 */
export function verifySkip(node: string, skip: SkipValue): SkipValue {
    if (!skip) {
        return false;
    }

    // true['string'] is a valid operation is JS resulting in `undefined`
    if ((skip as SkipTree)[node]) {
        return (skip as SkipTree)[node];
    }

    // lookup through wildcard patterns
    let nodeTree: SkipValue = false;
    const patterns = Object.keys(skip).filter(pattern => ~pattern.indexOf('*'));

    for (const pattern of patterns) {
        const rx: RegExp = new RegExp(pattern.replace(RX_AST, '.*'));

        if (rx.test(node)) {
            nodeTree = (skip as SkipTree)[pattern];

            // istanbul ignore else
            if (nodeTree === true) {
                break;
            }
        }
    }

    return nodeTree;
}

/**
 * Traverses recursively given nodes and fills-up given root tree with
 * a requested field names
 *
 * @param {ReadonlyArray<FieldNode>} nodes
 * @param {MapResult | MapResultKey} root
 * @param {TraverseOptions} opts
 * @param {SkipValue} skip
 * @return {MapResult}
 * @access private
 */
export function traverse(
    nodes: ReadonlyArray<SelectionNode>,
    root: MapResult | MapResultKey,
    opts: TraverseOptions,
    skip: SkipValue,
): MapResult | MapResultKey {
    for (const node of nodes) {
        if (opts.withVars && !verifyDirectives(node.directives, opts.vars)) {
            continue;
        }

        if (verifyInlineFragment(node, root, opts, skip)) {
            continue;
        }

        const name = (node as FieldNode).name.value;

        if (opts.fragments[name]) {
            traverse(getNodes(opts.fragments[name]), root, opts, skip);

            continue;
        }

        const nodes = getNodes(node);
        const nodeSkip = verifySkip(name, skip);

        if (nodeSkip !== true) {
            (root as MapResult)[name] = (root as MapResult)[name] || (
                nodes.length ? {} : false
            );

            nodes.length && traverse(
                nodes,
                (root as MapResult)[name],
                opts,
                nodeSkip,
            );
        }
    }

    return root;
}

/**
 * Retrieves and returns a branch from a given tree by a given path
 *
 * @param {MapResult} tree
 * @param {string} [path]
 * @return {MapResult}
 * @access private
 */
export function getBranch(tree: MapResult, path?: string): MapResult {
    if (!path) {
        return tree;
    }

    for (const fieldName of path.split('.')) {
        const branch = tree[fieldName];

        if (!branch) {
            return {};
        }

        tree = branch;
    }

    return tree;
}

/**
 * Verifies if a given info object is valid. If valid - returns
 * proper FieldNode object for given resolver node, otherwise returns null.
 *
 * @param {GraphQLResolveInfo} info
 * @return {FieldNode | null}
 * @access private
 */
export function verifyInfo(info: GraphQLResolveInfo): SelectionNode | null {
    if (!info) {
        return null;
    }

    if (!info.fieldNodes && (info as any).fieldASTs) {
        (info as any).fieldNodes = (info as any).fieldASTs;
    }

    if (!info.fieldNodes) {
        return null;
    }

    return verifyFieldNode(info);
}

/**
 * Verifies if a proper fieldNode existing on given info object
 *
 * @param {GraphQLResolveInfo} info
 * @return {FieldNode | null}
 * @access private
 */
export function verifyFieldNode(info: GraphQLResolveInfo): FieldNode | null {
    const fieldNode: FieldNode | undefined = info.fieldNodes.find(
        (node: FieldNode) =>
            node && node.name && node.name.value === info.fieldName
    );

    if (!(fieldNode && fieldNode.selectionSet)) {
        return null;
    }

    return fieldNode;
}

/**
 * Parses input options and returns prepared options object
 *
 * @param {FieldsListOptions} options
 * @return {FieldsListOptions}
 * @access private
 */
export function parseOptions(options?: FieldsListOptions): FieldsListOptions {
    if (!options) {
        return {};
    }

    if (options.withDirectives === undefined) {
        options.withDirectives = true;
    }

    return options;
}

/**
 * Combines parent path with child name to fully-qualified dot-notation path
 * of a child
 *
 * @param {string} parent
 * @param {string} child
 * @return {string}
 * @access private
 */
export function toDotNotation(parent: string, child: string): string {
    return `${parent ? parent + '.' : ''}${child}`
}