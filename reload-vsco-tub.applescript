-- Reload the isolated VSCO Tub unpacked extension in Chrome.
-- Enable System Events / Accessibility for Script Editor or osascript first.

property extensionName : "VSCO Tub — Search Results QA (86e9)"

tell application "Google Chrome"
	activate
	set managerTab to make new tab at end of window 1 with properties {URL:"chrome://extensions/"}
end tell

delay 1.5

tell application "System Events"
	tell process "Google Chrome"
		-- Chrome's extensions manager renders extension cards inside the web area.
		set webArea to first UI element of window 1 whose role description is "web area"
		set card to missing value
		repeat 20 times
			try
				set card to first UI element of webArea whose description contains extensionName
				exit repeat
			on error
				delay 0.25
			end try
		end repeat
		if card is missing value then error "Could not find extension card: " & extensionName
		set reloadButton to missing value
		try
			set reloadButton to first button of card whose description is "Reload"
		on error
			try
				set reloadButton to first button of card whose title is "Reload"
			on error
				error "Could not find Reload button for: " & extensionName
			end try
		end try
		perform action "AXPress" of reloadButton
	end tell
end tell

delay 0.7

tell application "Google Chrome"
	close managerTab
end tell
