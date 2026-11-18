# Data notice (v6)

The volumes in `scene/ct-intensity.nrrd` and `scene/ct-labels.nrrd` are derived from one series of the **Pancreas-CT** collection of The Cancer Imaging Archive (TCIA):

- Series instance UID `1.2.826.0.1.3680043.2.1125.1.77419915248783746629465382576486048` (coded patient id PANCREAS_0051, 185 CT images).
- Licence reported by the archive API for this series: Creative Commons Attribution 3.0 Unported, http://creativecommons.org/licenses/by/3.0/
- Collection DOI: https://doi.org/10.7937/K9/TCIA.2016.tNB1kqBU

Attribution (the collection's standard citation, written from memory of the collection page and not re-read in this build, so check it against the DOI page): Roth HR, Farag A, Turkbey EB, Lu L, Liu J, Summers RM. Data From Pancreas-CT. The Cancer Imaging Archive. 2016. Clark K, et al. The Cancer Imaging Archive (TCIA): maintaining and operating a public information repository. J Digit Imaging 26(6), 2013.

Changes made: block-mean resampling to 2.8 x 2.0 x 2.8 mm voxels, HU window -200 to 500 into 8 bits, and a derived four-class label volume (HU bands). The derived files are shared under the same CC BY 3.0 terms. The original DICOM files are not committed; `build.py` downloads them from the archive into `data/cache/` (git-ignored). Educational use only; not for diagnosis. Not legal advice.

## v7 addition: pancreas label

`scene/ct-organ-labels.nrrd` adds segment id 5 from `TCIA_pancreas_labels-02-05-2017/label0051.nii.gz` (https://www.cancerimagingarchive.net/wp-content/uploads/TCIA_pancreas_labels-02-05-2017.zip), the NIH pancreas segmentation of this series (collection page: segmented by a medical student, verified or modified by an experienced radiologist). Changes made: slice axis flipped to match the DICOM, block resampling, merged with the v6 density-band labels. The label zip carries no separate licence statement that this build found; it is treated as covered by the collection's CC BY 3.0 and must be checked before reuse. The label zip is not committed (git-ignored cache).
