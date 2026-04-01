import os, re
files = ['src/pages/CharterPage.tsx', 'src/components/TravelTimeline.tsx', 'src/components/WizardForm.tsx', 'src/pages/PlannerPage.tsx', 'src/components/CharterBanner.tsx', 'src/components/KpopShuttleBanner.tsx']
ko_pattern = re.compile(r'[가-힣]+')
for f in files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            lines = file.readlines()
            print(f'\n--- {f} ---')
            for i, line in enumerate(lines):
                if ko_pattern.search(line) and not '//' in line and not '/*' in line and not '* ' in line and not 'p.' in line and not 'c.' in line:
                    print(f'{i+1}: {line.strip()}')
