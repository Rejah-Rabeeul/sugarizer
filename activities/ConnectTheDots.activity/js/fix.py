import sys

file_path = r'c:\Users\MSI PC\Desktop\real\sugarizer\activities\ConnectTheDots.activity\js\activity.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/presencepalette"], function (activity, env, presencepalette) {\n    \'use strict\';\n\n    const canvas',
    'define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/presencepalette"], function (activity, env, presencepalette) {\n    \'use strict\';\n\n    requirejs([\'domReady!\'], function (doc) {\n\n    const canvas'
)

# Also handle \r\n just in case
content = content.replace(
    'define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/presencepalette"], function (activity, env, presencepalette) {\r\n    \'use strict\';\r\n\r\n    const canvas',
    'define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/presencepalette"], function (activity, env, presencepalette) {\r\n    \'use strict\';\r\n\r\n    requirejs([\'domReady!\'], function (doc) {\r\n\r\n    const canvas'
)

content = content.replace("setMode(e, '../icons/free-paint.svg', 'draw')", "setMode(e, 'icons/free-paint.svg', 'draw')")
content = content.replace("setMode(e, '../icons/challenge.svg', 'number')", "setMode(e, 'icons/challenge.svg', 'number')")
content = content.replace("setMode(e, '../icons/difficulty.svg', 'game')", "setMode(e, 'icons/difficulty.svg', 'game')")

content = content.replace(
'''        if (environment.user && environment.user.colorvalue) {
            // Setup the User's color dynamically Syncing with Sugarizer Env!
            currentColor = environment.user.colorvalue.fill || currentColor;
            gameState.players.user.color = currentColor;
            render();
        }
    });

});''',
'''        if (environment.user && environment.user.colorvalue) {
            // Setup the User's color dynamically Syncing with Sugarizer Env!
            currentColor = environment.user.colorvalue.fill || currentColor;
            gameState.players.user.color = currentColor;
            render();
        }
    });

    });

});'''
)
# And with \r\n
content = content.replace(
'''        if (environment.user && environment.user.colorvalue) {\r
            // Setup the User's color dynamically Syncing with Sugarizer Env!\r
            currentColor = environment.user.colorvalue.fill || currentColor;\r
            gameState.players.user.color = currentColor;\r
            render();\r
        }\r
    });\r
\r
});''',
'''        if (environment.user && environment.user.colorvalue) {\r
            // Setup the User's color dynamically Syncing with Sugarizer Env!\r
            currentColor = environment.user.colorvalue.fill || currentColor;\r
            gameState.players.user.color = currentColor;\r
            render();\r
        }\r
    });\r
\r
    });\r
\r
});'''
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("done")
