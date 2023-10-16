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
    FragmentDefinitionNode,
} from 'graphql/language';
import {
    getBranch, getNodes, parseOptions, skipTree, toDotNotation, traverse, verifyInfo 
} from './src';


/**
 * Fragment item type
 *
 * @access public
 */
export interface FragmentItem {
    [name: string]: FragmentDefinitionNode;
}

/**
 * Field names transformation map interface
 *
 * @access public
 */
export interface FieldNamesMap {
    [name: string]: string;
}

/**
 * fieldsList options argument interface
 *
 * @access public
 */
export interface FieldsListOptions {
    /**
     * Path to a tree branch which should be mapped during fields extraction
     * @type {string}
     */
    path?: string;

    /**
     * Transformation rules which should be used to re-name field names
     * @type {FieldNamesMap}
     */
    transform?: FieldNamesMap;

    /**
     * Flag which turns on/off GraphQL directives checks on a fields
     * and take them into account during fields analysis
     * @type {boolean}
     */
    withDirectives?: boolean;

    /**
     * Flag which turns on/off whether to return the parent fields or not
     * @type {boolean}
     */
    keepParentField?: boolean;

    /**
     * Fields skip rule patterns. Usually used to ignore part of request field
     * subtree. For example if query looks like:
     * profiles {
     *   id
     *   users {
     *     name
     *     email
     *     password
     *   }
     * }
     * and you doo n not care about users, it can be done like:
     * fieldsList(info, { skip: ['users'] }); // or
     * fieldsProjection(info, { skip: ['users.*'] }); // more obvious notation
     *
     * If you want to skip only exact fields, it can be done as:
     * fieldsMap(info, { skip: ['users.email', 'users.password'] })
     */
    skip?: string[];
}

/**
 * Type definition for variables values map
 *
 * @access public
 */
export interface VariablesValues {
    [name: string]: any;
}

/**
 * Fields projection object, where keys are dot-notated field paths
 * ended-up with a truthy (1) value
 *
 * @access public
 */
export interface FieldsProjection {
    [name: string]: 1;
}

export type MapResultKey = false | MapResult;
export type MapResult = { [key: string]: MapResultKey };

/**
 * Extracts and returns requested fields tree.
 * May return `false` if path option is pointing to leaf of tree
 *
 * @param {GraphQLResolveInfo} info
 * @param {FieldsListOptions} options
 * @return {MapResult}
 * @access public
 */
export function fieldsMap(
    info: GraphQLResolveInfo,
    options?: FieldsListOptions,
): MapResult {
    const fieldNode = verifyInfo(info);

    if (!fieldNode) {
        return {};
    }

    const { path, withDirectives, skip } = parseOptions(options);
    const tree = traverse(getNodes(fieldNode), {}, {
            fragments: info.fragments,
            vars: info.variableValues,
            withVars: withDirectives,
        },
        skipTree(skip || []),
    ) as MapResult;

    return getBranch(tree, path);
}

/**
 * Extracts list of selected fields from a given GraphQL resolver info
 * argument and returns them as an array of strings, using the given
 * extraction options.
 *
 * @param {GraphQLResolveInfo} info - GraphQL resolver info object
 * @param {FieldsListOptions} [options] - fields list extraction options
 * @return {string[]} - array of field names
 * @access public
 */
export function fieldsList(
    info: GraphQLResolveInfo,
    options: FieldsListOptions = {},
): string[] {
    return Object.keys(fieldsMap(info, options)).map((field: string) =>
        (options.transform || {})[field] || field,
    );
}

/**
 * Extracts projection of selected fields from a given GraphQL resolver info
 * argument and returns flat fields projection object, where keys are object
 * paths in dot-notation form.
 *
 * @param {GraphQLResolveInfo} info - GraphQL resolver info object
 * @param {FieldsListOptions} options - fields list extraction options
 * @return {FieldsProjection} - fields projection object
 * @access public
 */
export function fieldsProjection(
    info: GraphQLResolveInfo,
    options?: FieldsListOptions,
): FieldsProjection {
    const tree = fieldsMap(info, options);
    const stack: any[] = [];
    const map: FieldsProjection = {};
    const transform = (options || {}).transform || {};

    stack.push({ node: '', tree });

    while (stack.length) {
        for (const j of Object.keys(stack[0].tree)) {
            if (stack[0].tree[j]) {
                const nodeDottedName = toDotNotation(stack[0].node, j);

                stack.push({
                    node: nodeDottedName,
                    tree: stack[0].tree[j],
                });

                if (options?.keepParentField) map[nodeDottedName] = 1;

                continue;
            }

            let dotName = toDotNotation(stack[0].node, j);

            if (transform[dotName]) {
                dotName = transform[dotName];
            }

            map[dotName] = 1;
        }

        stack.shift();
    }

    return map;
}
