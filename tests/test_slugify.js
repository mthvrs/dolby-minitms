const assert = require('assert');
const { slugify } = require('../utils/stringUtils');

function runTests() {
    console.log('Running tests for slugify...');

    try {
        // Test basic string
        assert.strictEqual(slugify('Foo Bar'), 'foo-bar', 'Should convert to lowercase and replace spaces with hyphens');

        // Test multiple spaces
        assert.strictEqual(slugify('Foo   Bar'), 'foo-bar', 'Should replace multiple spaces with single hyphen');

        // Test leading/trailing spaces (implementation doesn't trim, let's check current behavior)
        // Original: String(name).toLowerCase().replace(/\s+/g, '-')
        // " Foo " -> "-foo-"
        assert.strictEqual(slugify(' Foo '), '-foo-', 'Should preserve behavior for leading/trailing spaces');

        // Test special characters (implementation doesn't remove them)
        assert.strictEqual(slugify('Foo! Bar'), 'foo!-bar', 'Should not remove special characters');

        // Test numbers
        assert.strictEqual(slugify(123), '123', 'Should handle numbers as strings');

        // Test null/undefined (String(null) -> "null")
        assert.strictEqual(slugify(null), 'null', 'Should handle null as "null" string');
        assert.strictEqual(slugify(undefined), 'undefined', 'Should handle undefined as "undefined" string');

        console.log('All tests passed!');
    } catch (e) {
        console.error('Test failed:', e.message);
        process.exit(1);
    }
}

runTests();
