from utils.gee_utils import get_gee_status

status = get_gee_status()

if status["initialized"]:
    print("SUCCESS: GEE is successfully initialized!")
    print("Project:", status["configured_project"])
    print("Test Number:", status["ee_test_value"])
else:
    print("ERROR GEE Initialization Failed!", status["error"])
    print("Configured Project:", status["configured_project"])
