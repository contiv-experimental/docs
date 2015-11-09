require('mdoc').run({
  // configuration options (specified below)
  inputDir: 'source',
  outputDir: 'dist',
	indexContentPath: "source/1_index.md",
  exclude: '.*,*.go',
	baseTitle: 'volplugin Documentation',
  mapTocName: function(filename, tocObj, title) {
    dirs = filename.split('/')
    strings = dirs[dirs.length-1].split('_')

    if (dirs[dirs.length-2] != null) {
      return dirs[dirs.length-2] + ": " + strings[0] + ". " + title
    }

    return strings[0] + ". " + title
  }
})
