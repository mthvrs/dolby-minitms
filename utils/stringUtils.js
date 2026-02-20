function slugify(name) {
    return String(name).toLowerCase().replace(/\s+/g, '-');
}

module.exports = {
    slugify
};
