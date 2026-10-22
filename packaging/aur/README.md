# Arch packaging

No AUR package is published for CardMirror Advanced. The inherited upstream
recipe is retained as `PKGBUILD.upstream-reference` for provenance and is not
an install recipe for this fork. Do not publish it unchanged.

After a verified fork release, install its `.pacman` artifact directly with
`pacman -U`. Any future AUR recipe must use this fork's release URLs, a distinct
package name, the Advanced executable, and verified checksums.
