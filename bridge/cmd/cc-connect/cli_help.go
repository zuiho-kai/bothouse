package main

// isHelpArg: the argument asks for usage. Commands check their arguments for it before they
// open a socket, go online, write a file or drive the service manager: `bothouse update --help`
// once ran a real update because update ignored arguments it did not know.
func isHelpArg(a string) bool {
	return a == "-h" || a == "--help" || a == "-help" || a == "help"
}
