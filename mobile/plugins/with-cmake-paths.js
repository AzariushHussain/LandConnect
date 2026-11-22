const { withAppBuildGradle } = require('expo/config-plugins');

// Ninja on Windows rejects some generated gesture-handler paths above 260 characters.
module.exports = function withCmakePaths(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== 'groovy') {
      throw new Error('with-cmake-paths expects the generated Groovy Android app build file.');
    }
    const marker = '// LandConnect: shorten generated CMake object paths';
    if (result.modResults.contents.includes(marker)) {
      result.modResults.contents = result.modResults.contents.replace(
        /-DCMAKE_OBJECT_PATH_MAX=\d+/g,
        '-DCMAKE_OBJECT_PATH_MAX=250',
      );
    } else {
      result.modResults.contents += `
${marker}
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=250"
            }
        }
    }
}
`;
    }
    return result;
  });
};
