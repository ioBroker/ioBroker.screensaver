import React from 'react';

/**
 * The file browser of the folder field, loaded only when its button is pressed: it is large and needed in the
 * editor only.
 *
 * A module of its own, and a chunk of its own (`vite.config.ts`): `vite-plugin-top-level-await` wraps every chunk
 * that contains a dynamic `import()` into an asynchronous block, but does not make the chunks that import it wait
 * for that block. In the chunk shared by the widgets this left `Generic` undefined while `PhotoFrame` was
 * evaluated ("Class extends value undefined"). Here the block holds nothing but this component, which is only
 * read when the field renders.
 */
const FolderDialog = React.lazy(() => import('./FolderDialog'));

export default FolderDialog;
