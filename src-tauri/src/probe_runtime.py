"""Validate the common, standard-GIL embedded interpreter before publication."""
import sys
import sysconfig


def validate_runtime(version, platform_tag, free_threaded, expected_platform=None):
    if tuple(version[:3]) != (3, 13, 17):
        raise RuntimeError('Unsupported embedded Python version; reinstall the AI environment')
    if expected_platform is not None:
        actual = 'macos-arm64' if platform_tag.startswith('macosx-') and platform_tag.endswith('-arm64') else platform_tag
        if actual != expected_platform:
            raise RuntimeError('Embedded Python architecture does not match the application')
    if free_threaded:
        raise RuntimeError('AI packages require the standard-GIL Python ABI')
    if platform_tag not in ('win-amd64', 'win-arm64') and not (
        platform_tag.startswith('macosx-') and platform_tag.endswith('-arm64')
    ):
        raise RuntimeError('Unsupported embedded Python platform')


if __name__ == '__main__':
    import ssl, ensurepip, venv, ctypes, sqlite3
    validate_runtime(sys.version_info, sysconfig.get_platform(), bool(sysconfig.get_config_var('Py_GIL_DISABLED')), globals().get('EXPECTED_PLATFORM'))
