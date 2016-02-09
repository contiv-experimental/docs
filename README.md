# docs.contiv.io

##### Use the below steps to make and publish changes to docs.contiv.io
- Add/Edit documentation to/in the source folder
- Build the changes.

        make build-docs
- Commit the changes (including the changes in dist folder)

        git commit -m "updated the docs to add .."
- Publish the changes to the docs webpages

        git subtree push --prefix dist origin gh-pages
