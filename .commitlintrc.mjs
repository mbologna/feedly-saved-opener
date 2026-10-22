// Conventional Commits, self-contained: no `extends`, so the hook works in a
// fresh clone without `npm install` (a global commitlint can't resolve a shared
// config package from a repo with no node_modules). Mirrors
// @commitlint/config-conventional, with this repo's looser subject-case and
// 100-character header.
export default {
    parserPreset: {
        parserOpts: {
            headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
            headerCorrespondence: ['type', 'scope', 'subject'],
            noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
            revertPattern: /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
            revertCorrespondence: ['header', 'hash'],
            issuePrefixes: ['#'],
        },
    },
    rules: {
        'body-leading-blank': [1, 'always'],
        'body-max-line-length': [2, 'always', 100],
        'footer-leading-blank': [1, 'always'],
        'footer-max-line-length': [2, 'always', 100],
        'header-max-length': [2, 'always', 100],
        'header-trim': [2, 'always'],
        'subject-case': [2, 'never', ['upper-case']],
        'subject-empty': [2, 'never'],
        'subject-full-stop': [2, 'never', '.'],
        'type-case': [2, 'always', 'lower-case'],
        'type-empty': [2, 'never'],
        'type-enum': [
            2,
            'always',
            ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
        ],
    },
};
