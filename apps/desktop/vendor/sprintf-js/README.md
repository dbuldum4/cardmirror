# Bounded sprintf-js

This private fork contains the original sprintf-js 1.1.3 implementation under
its original BSD-3-Clause license. It fixes GHSA-hp3w-g68c-fv3c by refusing format
width/precision above 10,000 before formatting, limiting format length to 65,536,
and bounding the parse cache to 256 entries. Normal sprintf/vsprintf exports and
format syntax are preserved. This package is only used by desktop packaging
dependencies. It is identified by a separate private package name so the
lockfile accurately records that this is a local patched implementation.

Remove this override when an upstream fixed version is available and verified.
